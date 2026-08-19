// Perft audit: the in-app engine's move generator must reproduce the
// standard node counts for known positions. Any mismatch fails CI.
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { engineCore } = await loadApp();

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASES = [
  { name: "startpos", fen: START_FEN, depths: { 3: 8902, 4: 197281, 5: 4865609 } },
  { name: "kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -", depths: { 3: 97862, 4: 4085603 } },
  { name: "ep position", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -", depths: { 4: 43238, 5: 674624 } },
  { name: "promotion", fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -", depths: { 3: 62379 } },
];

let checks = 0;
for (const c of CASES) {
  for (const [d, want] of Object.entries(c.depths)) {
    const core = engineCore();
    core.parseFen(c.fen);
    const t0 = Date.now();
    const got = core.perft(+d);
    assert.equal(got, want, `${c.name} d${d}: expected ${want}, got ${got}`);
    console.log(`  ok ${c.name} d${d} = ${got} (${Date.now() - t0}ms)`);
    checks++;
  }
}
console.log(`perft: ${checks} counts verified, all exact.`);
