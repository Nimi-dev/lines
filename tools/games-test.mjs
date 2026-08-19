// Verifies the real-game analysis engine (src/games.js): PGN parsing, the
// four-bucket tree walk, node-product coverage, leak ranking, and the
// pack-gain recommender. Uses synthetic games; if this machine also has the
// downloaded chess.com fixture (local dev), runs the full pipeline on it too.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { loadApp } from "./_load.mjs";
import { sanList, walkGame, analyzeGames, packGains, scorePct } from "../src/games.js";

const app = await loadApp();
const { buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, START, sq, posKey } = app;
const tree = buildTree(CORE_PACK_IDS);
const helpers = { sq, posKey, START };

// PGN parsing strips clock comments and move numbers
{
  const pgn = '[Event "x"]\n\n1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. Nf3 Nc6 3. d4 exd4 1-0';
  assert.deepStrictEqual(sanList(pgn), ["e4", "e5", "Nf3", "Nc6", "d4", "exd4"]);
}

// buckets
{
  const done = walkGame(tree, sq, posKey, START, ["e4", "e5", "Nf3", "Nc6", "d4", "d6", "dxe5", "dxe5", "Qxd8+", "Kxd8", "Bc4", "Be6", "Bxe6", "fxe6", "Nc3", "Bb4", "Bd2"]);
  assert.equal(done.kind, "done", "a full scripted run must land in done");
  const user = walkGame(tree, sq, posKey, START, ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  assert.equal(user.kind, "user"); assert.equal(user.expected, "3.d4"); assert.equal(user.played, "Bc4");
  const opp = walkGame(tree, sq, posKey, START, ["e4", "c5"]);
  assert.equal(opp.kind, "opp"); assert.equal(opp.ply, 1);
  const philTree = buildTree([...CORE_PACK_IDS, "philidor"]);
  const phil = walkGame(philTree, sq, posKey, START, ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3"]);
  assert.equal(phil.kind, "done", "the opera line must be covered once philidor is in the tree");
}

// analysis + recommender on synthetic data
{
  const G = (s, r, t) => ({ white: true, s, r, t: t || 1755500000, url: "" });
  const games = [
    ...Array.from({ length: 10 }, () => G(["e4", "e5", "Nf3", "Nc6", "d4", "d6", "dxe5", "dxe5", "Qxd8+", "Kxd8", "Bc4", "Be6", "Bxe6", "fxe6", "Nc3", "Bb4", "Bd2"], "win")),
    ...Array.from({ length: 6 }, () => G(["e4", "e5", "Nf3", "d6", "d4"], "checkmated")),   // Philidor leak, lost
    ...Array.from({ length: 4 }, () => G(["e4", "c5", "Nf3"], "win")),                       // Sicilian leak, won
    ...Array.from({ length: 3 }, () => G(["e4", "e5", "Nf3", "Nc6", "Nc3"], "resigned")),    // your deviation
  ];
  const r = analyzeGames(tree, helpers, games, { now: 1755600000000 });
  assert.equal(r.totals.e4, 23);
  assert.equal(r.totals.done, 10); assert.equal(r.totals.user, 3); assert.equal(r.totals.opp, 10);
  assert.ok(r.coverage > 0 && r.coverage < 1, "coverage must be a proper probability");
  assert.equal(r.misses.length, 1);
  assert.equal(r.misses[0].expected, "3.d4"); assert.equal(r.misses[0].n, 3);
  const top = r.leaks[0];
  assert.equal(top.move, "d6", "the lost Philidor leak must outrank the won Sicilian leak");
  // recommender: philidor pack absorbs the d6 leak
  const gains = packGains(tree, LEARNABLE_PACK_IDS.map((id) => ({ id, tree: buildTree([...CORE_PACK_IDS, id]) })), r.leaks);
  assert.ok(gains.length && gains[0].id === "philidor" && gains[0].n === 6, "philidor must be recommended for the 2...d6 leak");
}

// real fixture (local dev only — skipped in CI)
const FIX = "/private/tmp/claude-501/-Users-nimrodmeroz-lines/b0a624e4-b33c-490a-ad94-b7a529a7625f/scratchpad/games";
if (existsSync(FIX)) {
  const games = [];
  for (const f of readdirSync(FIX)) {
    for (const g of JSON.parse(readFileSync(FIX + "/" + f, "utf8")).games || []) {
      if (g.time_class !== "rapid" || g.rules !== "chess" || !g.pgn) continue;
      const asWhite = g.white.username.toLowerCase() === "nimiz26";
      if (!asWhite) continue;
      games.push({ white: true, s: sanList(g.pgn), r: g.white.result, t: g.end_time, url: g.url });
    }
  }
  const r = analyzeGames(tree, helpers, games);
  const phil = r.leaks.find((l) => l.move === "d6");
  console.log(`  fixture: ${r.totals.e4} e4-games | coverage ${(100 * r.coverage).toFixed(1)}% | done ${r.totals.done} | top leak ${r.leaks[0].move} (${r.leaks[0].n}×) | 2...d6 leak ${phil ? phil.n : 0}×`);
  assert.ok(phil && phil.n > 50, "fixture sanity: the Philidor leak should be large");
}

console.log("games: parsing, four-bucket walk, coverage, leak ranking, recommender verified.");
