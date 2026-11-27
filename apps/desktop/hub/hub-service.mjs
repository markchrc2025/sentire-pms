// Sentire PMS hub service (P2.1). Runs as a Windows service (WinSW) under LocalSystem.
// While C:\ProgramData\SentirePMS\control\hub.enabled exists it keeps two processes alive:
//   1. the bundled Postgres 18 (127.0.0.1 only), data in C:\ProgramData\SentirePMS\pgdata
//   2. the Sentire PMS app (Next.js standalone server) in hub mode on port 3000
// It restarts either one if it stops, and shuts both down cleanly when the service stops.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";
const exe = (n) => (isWin ? `${n}.exe` : n);

export const config = {
  dataRoot: process.env.PMS_DATA_ROOT ?? (isWin ? path.join(process.env.ProgramData ?? "C:\\ProgramData", "SentirePMS") : path.join(os.homedir(), ".sentire-pms")),
  pgBin: process.env.PMS_PG_BIN ?? path.join(here, "pgsql", "bin"),
  appDir: process.env.PMS_APP_DIR ?? path.join(here, "app"),
  nodeExe: process.env.PMS_NODE_EXE ?? process.execPath,
  pgPort: Number(process.env.PMS_PG_PORT ?? 54329),
  appPort: Number(process.env.PORT ?? 3000),
};
const p = (...x) => path.join(config.dataRoot, ...x);
const files = { marker: p("control", "hub.enabled"), secrets: p("hub.json"), pgdata: p("pgdata"), log: p("logs", "hub-service.log") };

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(files.log), { recursive: true });
    fs.appendFileSync(files.log, line + os.EOL);
  } catch {
    // Logging must never stop the service.
  }
}

/** Secrets made once per hub: database password and session secret. Never leave this PC. */
function secrets() {
  if (fs.existsSync(files.secrets)) return JSON.parse(fs.readFileSync(files.secrets, "utf8"));
  const s = { dbPassword: randomBytes(24).toString("base64url"), sessionSecret: randomBytes(32).toString("hex"), createdAt: new Date().toISOString() };
  fs.mkdirSync(config.dataRoot, { recursive: true });
  fs.writeFileSync(files.secrets, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

function initDatabase(s) {
  if (fs.existsSync(path.join(files.pgdata, "PG_VERSION"))) return;
  log("initialising the hub database");
  const pw = p("pw.tmp");
  fs.writeFileSync(pw, s.dbPassword, { mode: 0o600 });
  const r = spawnSync(path.join(config.pgBin, exe("initdb")), ["-D", files.pgdata, "-U", "pms", "--pwfile", pw, "-E", "UTF8", "--locale=C", "--auth=scram-sha-256"], { encoding: "utf8" });
  fs.rmSync(pw, { force: true });
  if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr || r.stdout}`);
  // Best effort: encrypt the data folder with Windows EFS where the edition supports it.
  if (isWin) spawnSync("cipher", ["/e", "/s:" + config.dataRoot], { encoding: "utf8" });
}

function pgCtl(args) {
  return spawnSync(path.join(config.pgBin, exe("pg_ctl")), ["-D", files.pgdata, ...args], { encoding: "utf8" });
}

function startPostgres() {
  const r = pgCtl(["start", "-w", "-t", "60", "-l", p("logs", "postgres.log"), "-o", `-p ${config.pgPort} -h 127.0.0.1`]);
  if (r.status !== 0 && !/another server might be running|already running/i.test(r.stderr + r.stdout)) throw new Error(`postgres did not start: ${r.stderr || r.stdout}`);
  log("postgres running");
}

function postgresRunning() {
  return pgCtl(["status"]).status === 0;
}

let app = null;
let stopping = false;
let appRestarts = 0;

function startApp(s) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PMS_MODE: "hub",
    PORT: String(config.appPort),
    HOSTNAME: "0.0.0.0",
    DATABASE_URL: `postgres://pms:${encodeURIComponent(s.dbPassword)}@127.0.0.1:${config.pgPort}/postgres`,
    SESSION_SECRET: s.sessionSecret,
    PMS_REQUIRE_PAIRING: process.env.PMS_REQUIRE_PAIRING ?? "1",
    PMS_MIGRATIONS_DIR: path.join(config.appDir, "drizzle"),
    APP_URL: `http://${os.hostname().toLowerCase()}:${config.appPort}`,
  };
  const server = path.join(config.appDir, "apps", "web", "server.js");
  app = spawn(config.nodeExe, [server], { cwd: path.dirname(server), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const out = fs.createWriteStream(p("logs", "app.log"), { flags: "a" });
  app.stdout.pipe(out);
  app.stderr.pipe(out);
  log(`app started (pid ${app.pid})`);
  app.on("exit", (code) => {
    log(`app exited with ${code}`);
    app = null;
    if (!stopping) setTimeout(() => tick(), Math.min(60_000, 2_000 * 2 ** Math.min(appRestarts++, 5)));
  });
  setTimeout(() => (appRestarts = 0), 120_000).unref();
}

function tick() {
  if (stopping) return;
  const enabled = fs.existsSync(files.marker);
  try {
    if (!enabled) {
      if (app) stopAll("hub turned off");
      return;
    }
    const s = secrets();
    initDatabase(s);
    if (!postgresRunning()) startPostgres();
    if (!app) startApp(s);
  } catch (e) {
    log(`error: ${e.message}`);
  }
}

function stopAll(reason) {
  log(`stopping (${reason})`);
  if (app) {
    app.removeAllListeners("exit");
    app.kill();
    app = null;
  }
  if (fs.existsSync(path.join(files.pgdata, "PG_VERSION")) && postgresRunning()) pgCtl(["stop", "-m", "fast", "-w"]);
}

export function main() {
  fs.mkdirSync(p("logs"), { recursive: true });
  log(`hub service starting; data in ${config.dataRoot}`);
  tick();
  const timer = setInterval(tick, 5_000);
  const shutdown = (sig) => {
    stopping = true;
    clearInterval(timer);
    stopAll(sig);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGBREAK", () => shutdown("SIGBREAK"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
