// Sentire Projects SessionStart hook for Claude Code.
// Starts a work session for the repo's project and prints the briefing, which Claude Code adds to the context.
// Needs: .sentire-projects.json in the repo root and SENTIRE_PROJECTS_TOKEN in the environment.
// Fails quietly: a tracking problem must never block a coding session.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let cfg;
try {
  cfg = JSON.parse(readFileSync(join(root, ".sentire-projects.json"), "utf8"));
} catch {
  process.exit(0);
}
const token = process.env.SENTIRE_PROJECTS_TOKEN;
if (!token) {
  console.log("Sentire Projects: SENTIRE_PROJECTS_TOKEN is not set, so this session is not tracked. Call start_session if the MCP server is connected.");
  process.exit(0);
}
// Only start one session per Claude Code session (resume and compact fire SessionStart again).
let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {}
let source = "startup";
try {
  source = JSON.parse(input).source || "startup";
} catch {}
if (source === "compact") process.exit(0);

const server = (cfg.server || "https://projects.apps.sentire.solutions").replace(/\/$/, "");
try {
  const res = await fetch(`${server}/api/v1/sessions/start?briefing=1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-sentire-client": "claude-code",
    },
    body: JSON.stringify({ project_key: cfg.project }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.log(`Sentire Projects: could not start a session (${res.status}).`);
    process.exit(0);
  }
  const data = await res.json();
  console.log(`Sentire Projects session_id: ${data.session.id} (pass it to update_issue, add_comment and end_session)\n`);
  console.log(data.briefing || "");
} catch (e) {
  console.log(`Sentire Projects: tracking unavailable (${e?.message || e}).`);
}
