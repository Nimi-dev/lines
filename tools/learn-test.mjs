// Verifies the Learn-flow logic (src/learn.js): every run in the full tree gets
// a complete annotated document (every ply has a SAN; doc aligns with the run's
// toks; a payoff explanation exists), clusters cover every gauntlet-able pack,
// and the learned-gate/next-up logic behaves.
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";
import { buildLineDoc, buildClusters, runStatus, grandfathered, learnNext, practiceNext } from "../src/learn.js";
import { retrievability, owned, foldResult } from "../src/scoring.js";

const app = await loadApp();
const { PACKS, EXTRAS, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, sq, posKey, START } = app;
const H = { sq, posKey, START };
const tree = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]);
const treeB = buildTree(app.BLACK_PACK_IDS, "black");
const ALL = [...tree.RUNS, ...treeB.RUNS];

// 1. every run (both sides) has a complete, aligned, annotated doc with a payoff
let annotated = 0;
for (const run of ALL) {
  const pack = PACKS.find((p) => p.id === run.packId);
  const doc = buildLineDoc(pack, EXTRAS[run.packId], run, H);
  assert.equal(doc.plies.length, run.toks.length, `${run.id}: doc/toks length mismatch (${doc.plies.length} vs ${run.toks.length})`);
  doc.plies.forEach((pl, i) => {
    assert.equal(pl.m, run.toks[i], `${run.id} ply ${i}: doc token ${pl.m} != run token ${run.toks[i]}`);
    assert.ok(pl.san, `${run.id} ply ${i}: missing san`);
  });
  assert.ok(doc.payoff && doc.payoff.text && doc.payoff.text.length > 40, `${run.id}: payoff explanation missing/too thin`);
  annotated += doc.plies.filter((p) => p.note || p.why).length;
}
assert.ok(annotated > 200, `expected rich annotations across the tree, got ${annotated}`);

// 2. clusters partition all runs across both sides
const clusters = buildClusters(PACKS, tree, treeB, CORE_PACK_IDS, LEARNABLE_PACK_IDS, app.BLACK_PACK_IDS);
const clusterRunCount = clusters.white.reduce((a, c) => a + c.runs.length, 0) + clusters.black.reduce((a, c) => a + c.runs.length, 0);
assert.equal(clusterRunCount, ALL.length, "clusters must partition all runs");
assert.equal(clusters.white.length, CORE_PACK_IDS.length + LEARNABLE_PACK_IDS.length);
assert.equal(clusters.black.length, app.BLACK_PACK_IDS.length);
assert.ok([...clusters.white, ...clusters.black].every((c) => c.chip && c.group && c.runs.length > 0));
// black runs carry side and odd-parity user keys
for (const r of treeB.RUNS) {
  assert.equal(r.side, "black");
  assert.ok(r.userKeys.every((k) => k.endsWith("1")), `${r.id}: black user positions must be Black-to-move`);
}

// 3. status + learned gate + grandfathering
const now = Date.parse("2026-08-20T08:00:00Z");
const r0 = tree.RUNS[0];
{
  const st = runStatus(r0, {}, {}, retrievability, owned, now);
  assert.deepStrictEqual([st.learned, st.walked, st.ownedN], [false, false, 0]);
  const st2 = runStatus(r0, { learned: { [r0.sig]: now }, walked: { [r0.sig]: now } }, {}, retrievability, owned, now);
  assert.ok(st2.learned && st2.walked);
  // owned positions counted live from memory
  const mem = {};
  for (const k of r0.userKeys) mem[k] = foldResult(null, true, now - 3600000, "start").rec;
  const st3 = runStatus(r0, {}, mem, retrievability, owned, now);
  assert.equal(st3.ownedN, r0.userKeys.length);
}
{
  assert.ok(!grandfathered(r0, {}, {}), "no history: not grandfathered");
  assert.ok(grandfathered(r0, { "2026-08-18": { plays: { [r0.sig]: { m: 0, u: 5 } } } }, {}), "a recorded day-play grandfathers the run");
  const mem = {};
  for (const k of r0.userKeys) mem[k] = { seen: 2 };
  assert.ok(grandfathered(r0, {}, mem), "full memory evidence grandfathers the run");
  mem[r0.userKeys[0]] = { seen: 0 };
  assert.ok(!grandfathered(r0, {}, mem), "partial evidence does not");
}

// 4. next-up ordering follows real-game frequency
{
  const probs = {}; tree.RUNS.forEach((r, i) => { probs[r.sig] = i === 3 ? 0.5 : 0.01; });
  const next = learnNext(tree.RUNS, {}, probs);
  assert.equal(next[0].sig, tree.RUNS[3].sig, "learnNext must lead with the most frequent line");
  const ls = { learned: { [tree.RUNS[3].sig]: 1, [tree.RUNS[4].sig]: 1 } };
  assert.ok(!learnNext(tree.RUNS, ls, probs).some((r) => ls.learned[r.sig]), "learned runs leave the learn queue");
  const pn = practiceNext(tree.RUNS, ls, {}, retrievability, probs, now);
  assert.equal(pn.length, 2);
  assert.equal(pn[0].sig, tree.RUNS[3].sig, "practiceNext ranks by frequency x (1-R)");
}

console.log(`learn: ${ALL.length} line docs complete (${annotated} annotated plies), clusters partition the tree, gates and ranking verified.`);
