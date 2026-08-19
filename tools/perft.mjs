// Perft audit: the in-app engine's move generator must reproduce the
// standard node counts for known positions. Any mismatch fails CI.
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { engineCore, sq, sqName, toFEN, applyMoves } = await loadApp();

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
// legalTargets — the board's move-hint hook. Same generator, so it inherits the
// perft guarantee; these cases pin the wiring (pins, castling, promotion, e.p.).
const TARGETS = [
  { name: "start g1 knight", fen: START_FEN, from: "g1", want: ["f3", "h3"] },
  { name: "start e2 pawn", fen: START_FEN, from: "e2", want: ["e3", "e4"] },
  { name: "absolutely pinned knight has none", fen: "4rk2/8/8/8/8/8/4N3/4K3 w - - 0 1", from: "e2", want: [] },
  { name: "castling offered as a king target", fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", from: "e1", want: ["d1", "d2", "e2", "f2", "f1", "c1", "g1"] },
  { name: "en passant target listed", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", from: "e5", want: ["e6", "d6"] },
  { name: "promotion square listed once", fen: "k7/3P4/8/8/8/8/8/4K3 w - - 0 1", from: "d7", want: ["d8"] },
];
for (const c of TARGETS) {
  const core = engineCore();
  const got = core.legalTargets(c.fen, sq(c.from)).map(sqName);
  assert.deepEqual(got.slice().sort(), c.want.slice().sort(), `${c.name}: got ${got}`);
  console.log(`  ok legalTargets ${c.name} (${got.length})`);
  checks++;
}

// toFEN's e.p. field: present only when the capture actually exists, so audit
// FENs stay byte-identical everywhere else.
const epCases = [
  { name: "no e.p. after 1.e4 (no black pawn adjacent)", moves: ["e2e4"], want: "-" },
  { name: "e.p. offered", moves: ["e2e4", "a7a6", "e4e5", "d7d5"], want: "d6" },
  { name: "double push with no taker", moves: ["e2e4", "a7a6", "d2d4"], want: "-" },
];
for (const c of epCases) {
  const fen = toFEN(applyMoves(c.moves), c.moves, c.moves.length);
  assert.equal(fen.split(/\s+/)[3], c.want, `${c.name}: ${fen}`);
  console.log(`  ok e.p. field ${c.name} = ${c.want}`);
  checks++;
}

console.log(`perft: ${checks} counts verified, all exact.`);
