// Pull the experience stream for an analysis session.
// Usage: node tools/fetch-telemetry.mjs [--since <ms|ISO>] [--type <t>] [--raw]
// Token: LINES_READ_TOKEN env var, or ~/.lines-read-token (one line).
// Prints a digest (or raw NDJSON with --raw) — the input for retrodiction,
// scoring analysis, and future self-improvement work.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const BASE = process.env.LINES_BASE || "https://lines-901.pages.dev";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const token = process.env.LINES_READ_TOKEN || (() => {
  try { return readFileSync(homedir() + "/.lines-read-token", "utf8").trim(); } catch (e) { return null; }
})();
if (!token) { console.error("no token: set LINES_READ_TOKEN or write ~/.lines-read-token"); process.exit(1); }

const sinceArg = opt("since");
const since = sinceArg ? (isNaN(+sinceArg) ? Date.parse(sinceArg) : +sinceArg) : 0;
const type = opt("type");
const url = `${BASE}/api/export?token=${encodeURIComponent(token)}&since=${since}&limit=10000${type ? "&type=" + type : ""}${args.includes("--raw") ? "&format=ndjson" : ""}`;

const res = await fetch(url);
if (!res.ok) { console.error("export failed:", res.status, await res.text()); process.exit(1); }
if (args.includes("--raw")) { process.stdout.write(await res.text()); process.exit(0); }

const d = await res.json();
console.log("events by type:", JSON.stringify(d.total_by_type));
console.log("fetched:", d.count, "(newest first)");
const days = {};
for (const e of d.events) {
  const day = new Date(e.t).toISOString().slice(0, 10);
  (days[day] = days[day] || []).push(e);
}
for (const [day, evs] of Object.entries(days)) {
  const by = {};
  for (const e of evs) by[e.type] = (by[e.type] || 0) + 1;
  const hp = evs.filter((e) => e.type === "hand_play");
  const clean = hp.filter((e) => e.data.clean).length;
  const lat = hp.filter((e) => e.data.latMs != null).map((e) => e.data.latMs).sort((a, b) => a - b);
  const med = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  console.log(`  ${day}: ${JSON.stringify(by)}${hp.length ? ` | hand-plays ${clean}/${hp.length} clean${med ? `, median latency ${med}ms` : ""}` : ""}`);
}
const snaps = d.events.filter((e) => e.type === "snapshot");
if (snaps.length) {
  const sMem = snaps[0].data.mem || {};
  console.log(`latest snapshot: ${Object.keys(sMem).length} positions, ${Object.keys(snaps[0].data.learn || {}).length} learned lines, lifetime ${JSON.stringify(snaps[0].data.lifetime)}`);
}
console.log("\nFor retrodiction on real history: extract per-position event vectors from hand_play events (key, t, clean, door, latMs) and feed tools/retrodict.mjs.");
