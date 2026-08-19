// Perft audit: the in-app engine's move generator must reproduce the
// standard node counts for known positions. Any mismatch fails CI.
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { engineCore, sq, sqName, toFEN, applyMoves, moveKind, pieceCount, evalRead, START } = await loadApp();

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

// inCheck — drives the board's check sound. Same attack routine the search uses.
const CHECKS = [
  { name: "startpos is not check", fen: START_FEN, want: false },
  { name: "rook checks down the file", fen: "4k3/8/8/8/8/8/8/4R2K b - - 0 1", want: true },
  { name: "blocked rook is not check", fen: "4k3/4p3/8/8/8/8/8/4R2K b - - 0 1", want: false },
  { name: "knight check", fen: "4k3/8/5N2/8/8/8/8/7K b - - 0 1", want: true },
];
// the real content position: the Petroff pack's 5.Nc6+ is a DISCOVERED check,
// and one ply earlier the e4 knight still blocks the queen's x-ray.
const petroff = ["e2e4","e7e5","g1f3","g8f6","f3e5","f6e4","d1e2","e4f6","e5c6"];
const fenAt = (n) => toFEN(applyMoves(petroff.slice(0, n)), petroff.slice(0, n), n);
CHECKS.push(
  { name: "Petroff x-ray still blocked (after 4.Qe2)", fen: fenAt(7), want: false },
  { name: "Petroff 5.Nc6+ discovers check", fen: fenAt(9), want: true },
);
for (const c of CHECKS) {
  const core = engineCore();
  assert.equal(core.inCheck(c.fen), c.want, `${c.name}: got ${core.inCheck(c.fen)}`);
  console.log(`  ok inCheck ${c.name}`);
  checks++;
}

// what a move sounds like — castle beats capture beats quiet move
const board = (moves) => applyMoves(moves);
const KINDS = [
  { name: "quiet move", tok: "e2e4", before: START, after: board(["e2e4"]) , want: "move" },
  { name: "capture", tok: "f3e5", before: board(["e2e4","e7e5","g1f3"]), after: board(["e2e4","e7e5","g1f3","b8c6","f3e5"]), want: "capture" },
  { name: "castle (two-leg token)", tok: "e1g1,h1f1", before: START, after: START, want: "castle" },
];
for (const c of KINDS) {
  const got = moveKind(c.tok, pieceCount(c.before), pieceCount(c.after));
  assert.equal(got, c.want, `${c.name}: got ${got}`);
  console.log(`  ok moveKind ${c.name} = ${got}`);
  checks++;
}
assert.equal(pieceCount(START), 32, "start position has 32 pieces");

// eval bar readout: the value the bar holds while the engine recomputes
const READS = [
  { ev: { cp: 0 }, label: "+0.0", pct: 50 },
  { ev: { cp: 400 }, label: "+4.0" },
  { ev: { cp: -250 }, label: "-2.5" },
  { ev: { mate: 3 }, label: "#+3", pct: 98 },
  { ev: { mate: -2 }, label: "#−2", pct: 2 },
];
for (const r of READS) {
  const got = evalRead(r.ev);
  assert.equal(got.label, r.label, `evalRead label: got ${got.label}`);
  if (r.pct != null) assert.equal(Math.round(got.pct), r.pct, `evalRead pct: got ${got.pct}`);
  assert.ok(got.pct >= 0 && got.pct <= 100, "evalRead pct in range");
  console.log(`  ok evalRead ${JSON.stringify(r.ev)} -> ${got.label} @ ${got.pct.toFixed(1)}%`);
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
