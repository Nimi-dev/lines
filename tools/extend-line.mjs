// Deepening helper: given a token prefix, print Stockfish's PV continuation
// with per-ply evals — the raw material for authoring line extensions.
// Usage: node extend-line.mjs "<toks>" [plies=6] [depth=22]
import { createRequire } from "node:module";
import { loadApp } from "./_load.mjs";
const { applyMoves, toFEN, sq, sqName, engineCore } = await loadApp();

const toks = process.argv[2].trim().split(/\s+/);
const PLIES = +(process.argv[3] || 6);
const DEPTH = +(process.argv[4] || 22);

const require = createRequire(new URL("../package.json", import.meta.url));
const engine = await require("stockfish")("lite-single");
const realWrite = process.stdout.write.bind(process.stdout);
let onLine = null;
const isUci = (t) => /^(info\b|bestmove\b|Stockfish \d|id \w|option name|uciok|readyok)/.test(t.trimStart());
process.stdout.write = (chunk) => {
  const t = String(chunk);
  if (!isUci(t)) return realWrite(chunk);
  if (onLine) t.split("\n").forEach((l) => l && onLine(l));
  return true;
};
const go = (fen) => new Promise((resolve) => {
  let score = null, pv = null;
  onLine = (t) => {
    const m = t.match(/^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+).*\bpv (.+)$/);
    if (m && +m[1] >= DEPTH - 2) { score = m[2] === "mate" ? { mate: +m[3] } : { cp: +m[3] }; pv = m[4].trim().split(/\s+/); }
    const bm = t.match(/^bestmove\s+(\S+)/);
    if (bm) resolve({ score, pv: pv || [bm[1]] });
  };
  engine.sendCommand("ucinewgame");
  engine.sendCommand("position fen " + fen);
  engine.sendCommand("go depth " + DEPTH);
});

// verify prefix legality + build fen
const core = engineCore();
let hist = [];
for (const t of toks) { hist.push(t); }
const b = applyMoves(hist);
const fen = toFEN(b, hist, hist.length);
process.stderr.write("from: " + fen + "\n");

// walk the PV, printing UCI + eval at each step (re-search each ply for accuracy)
let curHist = [...hist];
for (let i = 0; i < PLIES; i++) {
  const f = toFEN(applyMoves(curHist), curHist, curHist.length);
  const r = await go(f);
  const stm = f.split(/\s+/)[1];
  const povCp = r.score.mate != null ? (r.score.mate > 0 ? 30000 : -30000) : r.score.cp;
  const whiteCp = stm === "w" ? povCp : -povCp;
  const mv = r.pv[0];
  // convert 960-style castling (e1h1) to the app's e1g1 form if needed
  const cs = { e1h1: "e1g1,h1f1", e1a1: "e1c1,a1d1", e8h8: "e8g8,h8f8", e8a8: "e8c8,a8d8", e1g1: "e1g1,h1f1", e1c1: "e1c1,a1d1", e8g8: "e8g8,h8f8", e8c8: "e8c8,a8d8" };
  const tok = cs[mv] || mv;
  process.stderr.write(`ply ${curHist.length} (${stm}): ${tok}  whitePOV ${whiteCp}cp  pv: ${r.pv.slice(0, 6).join(" ")}\n`);
  curHist.push(tok);
}
process.stdout.write = realWrite;
console.log("extension toks:", curHist.slice(hist.length).join(" "));
process.exit(0);
