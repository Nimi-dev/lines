// Tree invariants over the FULL gauntlet-able tree (core + learnable packs):
// Law 1 machine-enforced — one position, one user move, across every pack that
// can ever share the gauntlet — plus token sanity (every scripted token moves
// the right color's piece from an occupied square; no capture of own piece).
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS, PACKS, EXTRAS, START, sq, posKey } = await loadApp();

const H = { sq, posKey, START: null };
const isWhitePc = (pc) => pc === pc.toUpperCase();

function checkSide(label, packIds, side) {
  const userPly = side === "black" ? 1 : 0;
  const tree = buildTree(packIds, side);
  const lines = [];
  for (const p of PACKS.filter((x) => packIds.includes(x.id))) {
    lines.push({ packId: p.id, name: "dream", plies: p.dream.map((d) => ({ m: d.m, san: d.san })) });
    for (const f of ((EXTRAS[p.id] && EXTRAS[p.id].futures) || [])) {
      lines.push({ packId: p.id, name: "future:" + f.t, plies: [...p.dream.map((d) => ({ m: d.m, san: d.san })), ...f.moves.map((d) => ({ m: d.m, san: d.san }))] });
    }
    const g = p.danger;
    const base = (g.base || p.dream.slice(0, g.baseCount).map((d) => d.m)).map((m, i) => ({ m, san: g.base ? "" : p.dream[i].san }));
    lines.push({ packId: p.id, name: "edge", plies: [...base, ...g.plies.map((d) => ({ m: d.m, san: d.san }))] });
    for (const x of (p.lines || [])) {
      const xb = (x.base || p.dream.slice(0, x.baseCount).map((d) => d.m)).map((m, i) => ({ m, san: x.base ? "" : p.dream[i].san }));
      lines.push({ packId: p.id, name: "edge:" + x.t, plies: [...xb, ...x.plies.map((d) => ({ m: d.m, san: d.san }))] });
    }
  }
  const userMove = {};
  let plies = 0;
  for (const L of lines) {
    let b = START.slice();
    for (let k = 0; k < L.plies.length; k++) {
      const { m, san } = L.plies[k];
      const key = posKey(b, k % 2);
      if (k % 2 === userPly) {
        const prev = userMove[key];
        assert.ok(!prev || prev.m === m,
          `LAW 1 VIOLATION [${label}]: position in ${L.packId}/${L.name} ply ${k} has two user moves: ${prev && prev.san} (${prev && prev.m}, ${prev && prev.packId}/${prev && prev.line}) vs ${san} (${m})`);
        userMove[key] = { m, packId: L.packId, san, line: L.name };
      }
      for (const g of m.split(",")) {
        assert.ok(/^[a-h][1-8][a-h][1-8]$/.test(g), `malformed token '${g}' in ${L.packId}/${L.name} ply ${k} — annotations belong in san, never in m`);
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
  const dupSigs = tree.RUNS.length - new Set(tree.RUNS.map((r) => r.sig)).size;
  assert.equal(dupSigs, 0, `[${label}] run signatures must be unique`);
  const dupIds = tree.RUNS.length - new Set(tree.RUNS.map((r) => r.id)).size;
  assert.equal(dupIds, 0, `[${label}] run ids must be unique`);
  assert.ok(tree.RUNS.every((r) => r.side === side), `[${label}] every run must carry side=${side}`);
  return { lines: lines.length, plies, positions: Object.keys(userMove).length, runs: tree.RUNS.length };
}

const w = checkSide("white", [...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS], "white");
const b = checkSide("black", BLACK_PACK_IDS, "black");
// cross-side sig uniqueness (they share export/day-play keyspaces)
const wt = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]);
const bt = buildTree(BLACK_PACK_IDS, "black");
const allSigs = [...wt.RUNS, ...bt.RUNS].map((r) => r.sig);
assert.equal(allSigs.length, new Set(allSigs).size, "sigs must be unique ACROSS sides");
const allIds = [...wt.RUNS, ...bt.RUNS].map((r) => r.id);
assert.equal(allIds.length, new Set(allIds).size, "run ids must be unique ACROSS sides");
console.log(`tree-invariant: WHITE ${w.lines} lines/${w.plies} plies/${w.positions} pos/${w.runs} runs · BLACK ${b.lines} lines/${b.plies} plies/${b.positions} pos/${b.runs} runs — Law 1 holds per side, tokens sane, sigs/ids unique across sides.`);
