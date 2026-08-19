// Tree invariants over the FULL gauntlet-able tree (core + learnable packs):
// Law 1 machine-enforced — one position, one user move, across every pack that
// can ever share the gauntlet — plus token sanity (every scripted token moves
// the right color's piece from an occupied square; no capture of own piece).
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, PACKS, EXTRAS, START, sq, posKey } = await loadApp();

const ALL = [...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS];
const tree = buildTree(ALL);

// rebuild the line list independently (buildRep silently last-writes user[key])
const lines = [];
for (const p of PACKS.filter((x) => ALL.includes(x.id))) {
  lines.push({ packId: p.id, name: "dream", plies: p.dream.map((d) => ({ m: d.m, san: d.san })) });
  for (const f of ((EXTRAS[p.id] && EXTRAS[p.id].futures) || [])) {
    lines.push({ packId: p.id, name: "future:" + f.t, plies: [...p.dream.map((d) => ({ m: d.m, san: d.san })), ...f.moves.map((d) => ({ m: d.m, san: d.san }))] });
  }
  const g = p.danger;
  const base = (g.base || p.dream.slice(0, g.baseCount).map((d) => d.m)).map((m, i) => ({ m, san: g.base ? "" : p.dream[i].san }));
  lines.push({ packId: p.id, name: "edge", plies: [...base, ...g.plies.map((d) => ({ m: d.m, san: d.san }))] });
}

const isWhitePc = (pc) => pc === pc.toUpperCase();
const userMove = {}; // key -> {m, packId, san, line}
let plies = 0;
for (const L of lines) {
  let b = START.slice();
  for (let k = 0; k < L.plies.length; k++) {
    const { m, san } = L.plies[k];
    const key = posKey(b, k % 2);
    if (k % 2 === 0) {
      const prev = userMove[key];
      assert.ok(!prev || prev.m === m,
        `LAW 1 VIOLATION: position reached in ${L.packId}/${L.name} ply ${k} has two user moves: ${prev && prev.san} (${prev && prev.m}, ${prev && prev.packId}/${prev && prev.line}) vs ${san} (${m})`);
      userMove[key] = { m, packId: L.packId, san, line: L.name };
    }
    for (const g of m.split(",")) {
      const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4));
      const pc = b[f];
      assert.ok(pc, `empty from-square in ${L.packId}/${L.name} ply ${k}: ${san || m} (${g})`);
      assert.equal(isWhitePc(pc), k % 2 === 0, `wrong color moves in ${L.packId}/${L.name} ply ${k}: ${san || m} moves '${pc}'`);
      assert.ok(!b[t] || isWhitePc(b[t]) !== isWhitePc(pc), `own-piece capture in ${L.packId}/${L.name} ply ${k}: ${san || m}`);
      b[t] = pc; b[f] = null;
    }
    plies++;
  }
}
assert.ok(tree.RUNS.length >= 20, `full tree should have >=20 runs, got ${tree.RUNS.length}`);
const dupSigs = tree.RUNS.length - new Set(tree.RUNS.map((r) => r.sig)).size;
assert.equal(dupSigs, 0, "run signatures must be unique");
const dupIds = tree.RUNS.length - new Set(tree.RUNS.map((r) => r.id)).size;
assert.equal(dupIds, 0, "run ids must be unique");
console.log(`tree-invariant: ${lines.length} lines, ${plies} plies, ${Object.keys(userMove).length} user positions across ${ALL.length} packs — Law 1 holds, tokens sane, ${tree.RUNS.length} runs with unique sigs/ids.`);
