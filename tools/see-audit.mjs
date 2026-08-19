// SEE audit: every scripted White (user) move in the repertoire tree must be
// statically sound — zero material-losing moves by static exchange evaluation
// on the move's landing square. The tree is SEE-clean; any regression fails CI.
// (Two shipped blunders — 8.Nxe5??, 10.Bd3?? — are exactly the class this catches.)
import assert from "node:assert/strict";
import { loadApp } from "./_load.mjs";

const { PACKS, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, engineCore, applyMoves, toFEN, posKey } = await loadApp();
const { REP, REPX } = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]); // audit the FULL gauntlet-able tree

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const FILE = (i) => i % 8, RANK = (i) => (i / 8) | 0;
const isWhite = (pc) => pc === pc.toUpperCase();

// squares of `side` ("w"/"b") pieces attacking square t under occupancy b
function attackersOf(b, t, side) {
  const out = [];
  const own = (pc) => (side === "w") === isWhite(pc);
  // pawns
  const pr = side === "w" ? -1 : 1; // pawn sits one rank behind its attack, from t's POV
  for (const df of [-1, 1]) {
    const f = FILE(t) + df, r = RANK(t) + pr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const s = r * 8 + f, pc = b[s];
      if (pc && pc.toLowerCase() === "p" && own(pc)) out.push(s);
    }
  }
  // knights and kings
  const JUMPS = [[1, 2, "n"], [2, 1, "n"], [-1, 2, "n"], [-2, 1, "n"], [1, -2, "n"], [2, -1, "n"], [-1, -2, "n"], [-2, -1, "n"],
    [0, 1, "k"], [0, -1, "k"], [1, 0, "k"], [-1, 0, "k"], [1, 1, "k"], [1, -1, "k"], [-1, 1, "k"], [-1, -1, "k"]];
  for (const [df, dr, kind] of JUMPS) {
    const f = FILE(t) + df, r = RANK(t) + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const s = r * 8 + f, pc = b[s];
    if (pc && pc.toLowerCase() === kind && own(pc)) out.push(s);
  }
  // sliders: first piece along each ray
  const RAYS = [[0, 1, "rq"], [0, -1, "rq"], [1, 0, "rq"], [-1, 0, "rq"], [1, 1, "bq"], [1, -1, "bq"], [-1, 1, "bq"], [-1, -1, "bq"]];
  for (const [df, dr, kinds] of RAYS) {
    let f = FILE(t) + df, r = RANK(t) + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const s = r * 8 + f, pc = b[s];
      if (pc) { if (kinds.includes(pc.toLowerCase()) && own(pc)) out.push(s); break; }
      f += df; r += dr;
    }
  }
  return out;
}

// best net gain for `side` initiating captures on t (0 = decline); x-rays via re-scan
function seeSwap(b, t, side) {
  if (!b[t]) return 0;
  const atks = attackersOf(b, t, side);
  if (!atks.length) return 0;
  let lva = atks[0];
  for (const s of atks) if (VAL[b[s].toLowerCase()] < VAL[b[lva].toLowerCase()]) lva = s;
  const captured = VAL[b[t].toLowerCase()];
  const nb = b.slice();
  nb[t] = nb[lva]; nb[lva] = null;
  return Math.max(0, captured - seeSwap(nb, t, side === "w" ? "b" : "w"));
}

// net material outcome of playing single-token move f→t as White
function seeOfMove(b, tok) {
  const sqi = (n) => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
  const f = sqi(tok.slice(0, 2)), t = sqi(tok.slice(2, 4));
  const capturedVal = b[t] ? VAL[b[t].toLowerCase()] : 0;
  const nb = b.slice();
  nb[t] = nb[f]; nb[f] = null;
  return capturedVal - seeSwap(nb, t, "b");
}

const decodeKey = (key) => key.slice(0, 64).split("").map((ch) => (ch === "." ? null : ch));

/* legality filter: run a real legal-move check for the FIRST recapture — a move
   that gives check (discovered or direct) often cannot legally be captured at
   all, and static SEE would wrongly flag it (e.g. the Petroff 5.Nc6+!). */
const core = engineCore();
const hasLegalRecapture = (fenAfter, targetSq) => {
  core.parseFen(fenAfter);
  return core.legalCaptureTargets().includes(targetSq);
};

/* self-check: the detector must flag a known blunder and clear a known-sound capture */
{
  const b1 = applyMoves(["e2e4", "e7e5", "g1f3", "b8c6"]);
  assert.ok(seeOfMove(b1, "f3e5") < 0, "self-check failed: 3.Nxe5?? (knight for defended pawn) not flagged");
  const b2 = applyMoves(["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4"]);
  assert.ok(seeOfMove(b2, "f3d4") >= 0, "self-check failed: sound 4.Nxd4 wrongly flagged");
}

const entries = Object.entries(REP.user);
assert.ok(entries.length > 0, "repertoire tree is empty — REP.user has no positions");

// histories per position (for legal-recapture FENs)
const histOf = new Map();
{
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = (g.charCodeAt(3) - 49) * 8 + (g.charCodeAt(2) - 97), fr = (g.charCodeAt(1) - 49) * 8 + (g.charCodeAt(0) - 97); nb[f] = nb[fr]; nb[fr] = null; } return nb; };
  for (const pt of REPX.paths) {
    let b = applyMoves([]); const hist = [];
    for (let k = 0; k < pt.toks.length; k++) {
      const key = posKey(b, k % 2);
      if (k % 2 === 0 && !histOf.has(key)) histOf.set(key, hist.slice());
      b = applyTok(b, pt.toks[k]); hist.push(pt.toks[k]);
    }
  }
}

let checked = 0, skippedCastle = 0, checkExempt = 0;
const losers = [];
for (const [key, u] of entries) {
  assert.equal(key[64], "0", `user-move position not White to move: ${key}`);
  const b = decodeKey(key);
  if (u.m.includes(",")) { skippedCastle++; continue; } // castling: no exchange on a landing square
  const net = seeOfMove(b, u.m);
  checked++;
  if (net < 0) {
    // before flagging: is the landing square actually capturable? (check-legality)
    const hist = histOf.get(key) || [];
    const nb = b.slice();
    const sqi = (n) => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
    const f = sqi(u.m.slice(0, 2)), t = sqi(u.m.slice(2, 4));
    nb[t] = nb[f]; nb[f] = null;
    const fenAfter = toFEN(nb, [...hist, u.m], hist.length + 1);
    if (!hasLegalRecapture(fenAfter, t)) { checkExempt++; continue; }
    losers.push({ san: u.san || u.m, m: u.m, packId: u.packId, net });
  }
}

for (const L of losers) {
  const chip = (PACKS.find((p) => p.id === L.packId) || {}).chip || L.packId;
  console.error(`  LOSING MOVE ${L.san} (${L.m}) in ${chip}: SEE ${L.net}`);
}
assert.equal(losers.length, 0, `${losers.length} material-losing scripted move(s) in the tree`);
console.log(`see-audit: ${checked} scripted White moves across ${entries.length} tree positions — zero material-losing (${skippedCastle} castling exempt, ${checkExempt} check-legality exempt).`);
