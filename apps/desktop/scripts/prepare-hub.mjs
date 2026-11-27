// Assemble apps/desktop/hub-dist for the Windows installer (run in CI on windows-latest after
// `pnpm --filter @sentire-pms/web build` with a hoisted node_modules, so there are no symlinks):
//   app/        Next.js standalone build, static files and SQL migrations
//   pgsql/      Postgres 18 binaries (from the @embedded-postgres/windows-x64 package)
//   node.exe    the Node.js runtime that runs the app and the service
//   sentire-pms-hub.exe + .xml   WinSW service wrapper
//   hub-service.mjs              the supervisor
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PG_PACKAGE = "@embedded-postgres/windows-x64@18.7.0-beta.19";
const WINSW_URL = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const web = path.join(root, "apps", "web");
const out = path.join(desktop, "hub-dist");
const cp = (a, b) => fs.cpSync(a, b, { recursive: true, dereference: true });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// App
cp(path.join(web, ".next", "standalone"), path.join(out, "app"));
cp(path.join(web, ".next", "static"), path.join(out, "app", "apps", "web", ".next", "static"));
if (fs.existsSync(path.join(web, "public"))) cp(path.join(web, "public"), path.join(out, "app", "apps", "web", "public"));
cp(path.join(root, "packages", "db", "drizzle"), path.join(out, "app", "drizzle"));

// Turbopack loads server externals (pg) under hashed names such as pg-587764f78a6c7a9c, which the
// standalone output provides as symlinks. Windows builds lose those links, so copy the package
// under each hashed name the server chunks ask for.
const chunks = path.join(out, "app", "apps", "web", ".next", "server");
const wanted = new Set();
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith(".js")) for (const m of fs.readFileSync(f, "utf8").matchAll(/["'`]((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)-([0-9a-f]{16})["'`]/g)) wanted.add(`${m[1]}|${m[2]}`);
  }
};
walk(chunks);
for (const w of wanted) {
  const [pkg, hash] = w.split("|");
  const src = path.join(out, "app", "node_modules", pkg);
  if (!fs.existsSync(src)) continue;
  cp(src, path.join(out, "app", "node_modules", `${pkg}-${hash}`));
  console.log(`linked external ${pkg}-${hash}`);
}

// Postgres
const tmp = path.join(desktop, ".pgpkg");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp);
execSync(`npm pack ${PG_PACKAGE} --silent`, { cwd: tmp, stdio: "inherit" });
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
execSync(`tar -xzf ${tgz}`, { cwd: tmp, stdio: "inherit" });
cp(path.join(tmp, "package", "native"), path.join(out, "pgsql"));
fs.rmSync(tmp, { recursive: true, force: true });
for (const bin of ["initdb.exe", "pg_ctl.exe", "postgres.exe"]) if (!fs.existsSync(path.join(out, "pgsql", "bin", bin))) throw new Error(`missing ${bin}`);

// Node runtime, service wrapper and supervisor
fs.copyFileSync(process.execPath, path.join(out, "node.exe"));
const res = await fetch(WINSW_URL);
if (!res.ok) throw new Error(`WinSW download failed: ${res.status}`);
fs.writeFileSync(path.join(out, "sentire-pms-hub.exe"), Buffer.from(await res.arrayBuffer()));
fs.copyFileSync(path.join(desktop, "hub", "sentire-pms-hub.xml"), path.join(out, "sentire-pms-hub.xml"));
fs.copyFileSync(path.join(desktop, "hub", "hub-service.mjs"), path.join(out, "hub-service.mjs"));

const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`hub-dist ready: ${(size(out) / 1e6).toFixed(1)} MB`);
