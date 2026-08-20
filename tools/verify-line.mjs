// Verify a candidate scripted line: legality of every token, and a cloud eval
// of every USER move (side-aware). Usage: node verify-line.mjs '<side>' 'tok tok tok…'
import { loadApp } from "./_load.mjs";
const { engineCore, applyMoves, toFEN, sq } = await loadApp();

const side = process.argv[2]; // "w" | "b"
const toks = process.argv[3].trim().split(/\s+/);
const userPly = side === "b" ? 1 : 0;
const core = engineCore();

const cloud = async (fen, multiPv = 3) => {
  try {
    const r = await fetch("https://lichess.org/api/cloud-eval?fen=" + encodeURIComponent(fen) + "&multiPv=" + multiPv, { headers: { "User-Agent": "lines-verify" } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.pvs || !d.pvs.length) return null;
    return { depth: d.depth, pvs: d.pvs.map((p) => ({ cp: p.mate != null ? (p.mate > 0 ? 30000 : -30000) : p.cp, first: p.moves.split(" ")[0] })) };
  } catch (e) { return null; } finally { await new Promise((r) => setTimeout(r, 1500)); }
};
const cs = { e1g1: "e1h1", e1c1: "e1a1", e8g8: "e8h8", e8c8: "e8a8" };
const same = (uci, tok) => uci === tok.split(",")[0] || cs[tok.split(",")[0]] === uci;

for (let k = 0; k < toks.length; k++) {
  const hist = toks.slice(0, k);
  const b = applyMoves(hist);
  const fen = toFEN(b, hist, k);
  // legality of the token
  const t0 = toks[k].split(",")[0];
  const legal = core.legalTargets(fen, sq(t0.slice(0, 2))).includes(sq(t0.slice(2, 4)));
  if (!legal) { console.log(`ply ${k}: ${toks[k]} ILLEGAL in ${fen}`); process.exit(1); }
  if (k % 2 !== userPly) continue;
  const cb = await cloud(fen, 3);
  if (!cb) { console.log(`ply ${k}: ${toks[k]} — no cloud data (${fen})`); continue; }
  const best = cb.pvs[0].cp;
  const mine = cb.pvs.find((p) => same(p.first, toks[k]));
  let after = mine ? mine.cp : null, src = mine ? "pv" : null;
  if (after == null) {
    const nb = applyMoves(toks.slice(0, k + 1));
    const ca = await cloud(toFEN(nb, toks.slice(0, k + 1), k + 1), 1);
    if (ca) { after = ca.pvs[0].cp; src = "direct"; }
  }
  const delta = after == null ? null : (side === "b" ? after - best : best - after); // cp given up vs best, from the user's POV
  console.log(`ply ${k}: ${toks[k]}  best=${best}  scripted=${after == null ? "?" : after}  Δ${delta == null ? "?" : delta}  (d${cb.depth}${src ? "," + src : ""})  top=${cb.pvs[0].first}`);
}
console.log("done");
