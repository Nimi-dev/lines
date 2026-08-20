// The corpus loop, step 1: a ranked backlog of missing lines, generated from
// real games. Frequency policy (CLAUDE.md): a branch earns coverage by how
// often opponents play it — this tool turns that policy into a work queue.
//
// Usage: node tools/corpus-gaps.mjs [--games <dir>] [--min 3] [--days N] [--user <name>]
//   --games  directory of chess.com month JSONs (default: the dev fixture)
//   --min    minimum occurrences to list (default 3)
//   --days   only games from the last N days (default: all)
//
// Classification per gap:
//   BRANCH  opponent played an unscripted move at a covered position -> add a
//           reply branch to the pack owning that zone
//   EXTEND  the book ran out mid-game with nobody deviating -> deepen the line
//   NEW     the game never touched the book (ply 0-1) -> new-pack territory
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadApp } from "./_load.mjs";
import { sanList, walkBreak, scorePct } from "../src/games.js";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const DIR = opt("games", "/private/tmp/claude-501/-Users-nimrodmeroz-lines/b0a624e4-b33c-490a-ad94-b7a529a7625f/scratchpad/games");
const MIN = +opt("min", 3);
const DAYS = +opt("days", 0);
const USER = (opt("user", "nimiz26") || "").toLowerCase();

const app = await loadApp();
const { buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS, PACKS, START, sq, posKey } = app;
const W = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]);
const B = buildTree(BLACK_PACK_IDS, "black");
const H = { sq, posKey, START };

if (!existsSync(DIR)) { console.error("no games dir:", DIR, "— pass --games <dir> of chess.com month JSONs"); process.exit(1); }
const cut = DAYS ? Date.now() / 1000 - DAYS * 86400 : 0;
const games = [];
for (const f of readdirSync(DIR)) {
  let d; try { d = JSON.parse(readFileSync(DIR + "/" + f, "utf8")); } catch (e) { continue; }
  for (const g of d.games || []) {
    if (g.time_class !== "rapid" || g.rules !== "chess" || !g.pgn || (g.end_time || 0) < cut) continue;
    const white = g.white.username.toLowerCase() === USER;
    games.push({ white, s: sanList(g.pgn), r: white ? g.white.result : g.black.result });
  }
}

const gaps = {}; // key: side|class|desc
const add = (side, cls, desc, g, extra) => {
  const k = side + "|" + cls + "|" + desc;
  const e = (gaps[k] = gaps[k] || { side, cls, desc, games: [], ...extra });
  e.games.push(g);
};
const mvNo = (ply) => Math.floor(ply / 2) + 1;

for (const g of games) {
  const side = g.white ? "WHITE" : "BLACK";
  const tree = g.white ? W : B;
  const userPly = g.white ? 0 : 1;
  const br = walkBreak(tree.REP, H, g.s, userPly);
  if (br.kind === "user" || br.inBookAtEnd) continue; // recall failures are practice signals, not gaps
  const prefix = g.s.slice(0, br.ply).join(" ");
  if (br.kind === "opp") {
    if (br.ply <= 1) add(side, "NEW", `1.${g.s[0]}` + (userPly === 1 ? "" : ` …${g.s[1] || ""}`), g);
    else {
      const zone = (tree.REP.zones[br.key] || []).map((id) => (PACKS.find((p) => p.id === id) || {}).chip || id).join("/");
      add(side, "BRANCH", `mv${mvNo(br.ply)} ${br.played}  after [${prefix}]`, g, { zone });
    }
  } else if (br.kind === "out") {
    if (br.ply <= 1) add(side, "NEW", `1.${g.s[0]}`, g);
    else {
      const zone = (tree.REP.zones[br.key] || []).map((id) => (PACKS.find((p) => p.id === id) || {}).chip || id).join("/");
      add(side, "EXTEND", `book ends mv${mvNo(br.ply)} after [${prefix}]`, g, { zone });
    }
  }
}

const rows = Object.values(gaps).filter((e) => e.games.length >= MIN)
  .sort((a, b) => b.games.length - a.games.length);
console.log(`corpus-gaps: ${games.length} games scanned${DAYS ? ` (last ${DAYS}d)` : ""} · ${rows.length} gaps with n ≥ ${MIN}\n`);
for (const side of ["WHITE", "BLACK"]) {
  const sr = rows.filter((r) => r.side === side);
  if (!sr.length) continue;
  console.log(`— ${side} —`);
  for (const r of sr.slice(0, 20)) {
    console.log(`  ${String(r.games.length).padStart(3)}×  ${r.cls.padEnd(6)} ${r.desc}${r.zone ? `  [zone: ${r.zone}]` : ""}  score ${scorePct(r.games)}%`);
  }
  console.log("");
}
console.log("next: draft toks for the top rows → tools/verify-line.mjs → author → gates → line-audit --sf --best. The corpus loop is documented in CLAUDE.md.");
