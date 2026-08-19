// Line audit: engine-check every scripted White move in the repertoire tree.
// For each user position: eval(position) vs eval(after scripted move) — a large
// drop means the scripted move loses value vs best play. Flagged moves are
// cross-checked against the Lichess masters database (--masters) before being
// treated as errors: a common master move is book, not a blunder.
// Usage: node tools/line-audit.mjs [--ms 2500] [--threshold 70] [--masters]
import { loadApp } from "./_load.mjs";

const { engineCore, START, sq, posKey, toFEN, PACKS, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS } = await loadApp();
const { REP, REPX } = buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]); // audit the FULL gauntlet-able tree

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? +args[i + 1] : dflt; };
const MS = opt("ms", 2500), THRESHOLD = opt("threshold", 70), MASTERS = args.includes("--masters");
const CLOUD = args.includes("--cloud"); // arbitrate every position with Lichess cloud Stockfish (deep) — the local engine misses deep refutations (10.Qe4? was Δ40 "clear" locally and −344cp at depth 23)

const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
const cp = (r) => (r.mate != null ? (r.mate > 0 ? 30000 - r.mate : -30000 - r.mate) : r.cp);

// collect unique user positions with a concrete history (for castling rights in the FEN)
const seen = new Map(); // key -> {b, hist, k, san, m, packId}
for (const pt of REPX.paths) {
  let b = START.slice();
  const hist = [];
  for (let k = 0; k < pt.toks.length; k++) {
    const key = posKey(b, k % 2);
    if (k % 2 === 0 && REP.user[key] && !seen.has(key)) {
      seen.set(key, { b: b.slice(), hist: hist.slice(), k, san: REP.user[key].san, m: REP.user[key].m, packId: REP.user[key].packId });
    }
    b = applyTok(b, pt.toks[k]);
    hist.push(pt.toks[k]);
  }
}
console.log(`auditing ${seen.size} unique scripted White positions (movetime ${MS}ms, threshold ${THRESHOLD}cp)…`);

// Lichess cloud eval (cp is White-POV). Returns null when the position is unknown to the cloud.
async function cloudEval(fen, multiPv = 1) {
  try {
    const res = await fetch("https://lichess.org/api/cloud-eval?fen=" + encodeURIComponent(fen) + "&multiPv=" + multiPv, { headers: { "User-Agent": "lines-line-audit" } });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.pvs || !d.pvs.length) return null;
    return { depth: d.depth, pvs: d.pvs.map((p) => ({ cp: p.mate != null ? (p.mate > 0 ? 30000 : -30000) : p.cp, first: p.moves.split(" ")[0] })) };
  } catch (e) { return null; } finally { await new Promise((r) => setTimeout(r, 1600)); }
}
const uciOf = (tok) => { const t = tok.split(",")[0]; return t; }; // castling: king leg only — lichess reports O-O as e1h1, so compare by target file too
const sameMove = (uci, tok) => { const t = uciOf(tok); if (uci === t) return true;
  // castling encodings: app "e1g1", lichess "e1h1" (and mirrors)
  const cs = { e1g1: "e1h1", e1c1: "e1a1", e8g8: "e8h8", e8c8: "e8a8" };
  return cs[t] === uci; };

const core = engineCore();
const results = [];
for (const [key, pos] of seen) {
  const fenBefore = toFEN(pos.b, pos.hist, pos.k);
  const after = applyTok(pos.b, pos.m);
  const fenAfter = toFEN(after, [...pos.hist, pos.m], pos.k + 1);
  let evalBefore, evalAfter, src = "local";
  if (CLOUD) {
    const cb = await cloudEval(fenBefore, 3);
    if (cb) {
      evalBefore = cb.pvs[0].cp;
      const mine = cb.pvs.find((p) => sameMove(p.first, pos.m));
      if (mine) { evalAfter = mine.cp; src = "cloud d" + cb.depth; }
      else {
        const ca = await cloudEval(fenAfter, 1);
        if (ca) { evalAfter = ca.pvs[0].cp; src = "cloud d" + Math.min(cb.depth, ca.depth); }
      }
    }
  }
  if (evalBefore == null || evalAfter == null) {
    evalBefore = cp(core.go(fenBefore, MS));
    evalAfter = cp(core.go(fenAfter, MS));
    src = "local d~8";
  }
  const delta = evalBefore - evalAfter; // how much the scripted move gives up vs best play
  results.push({ key, ...pos, fenBefore, evalBefore, evalAfter, delta, src });
  process.stdout.write(".");
}
console.log("");

const flagged = results.filter((r) => r.delta > THRESHOLD).sort((a, b) => b.delta - a.delta);
const chip = (id) => (PACKS.find((p) => p.id === id) || {}).chip || id;

if (MASTERS) {
  for (const f of flagged) {
    try {
      const res = await fetch("https://explorer.lichess.ovh/masters?fen=" + encodeURIComponent(f.fenBefore) + "&topGames=0&moves=8");
      const d = await res.json();
      const total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
      const clean = (s) => s.replace(/[!?]+$/, "").replace(/^\d+\.+/, "");
      const mine = (d.moves || []).find((m) => m.san === clean(f.san));
      const mn = mine ? mine.white + mine.draws + mine.black : 0;
      f.masters = {
        total,
        scriptedShare: total ? +(100 * mn / total).toFixed(1) : 0,
        top: (d.moves || []).slice(0, 3).map((m) => `${m.san} ${(100 * (m.white + m.draws + m.black) / total).toFixed(0)}%`),
      };
      await new Promise((r) => setTimeout(r, 1200)); // be polite to the API
    } catch (e) { f.masters = { error: String(e) }; }
  }
}

console.log(`\n${flagged.length} flagged of ${results.length}:`);
for (const f of flagged) {
  console.log(`  ${f.san} [${chip(f.packId)}] loses ${f.delta}cp (before ${f.evalBefore} → after ${f.evalAfter}, ${f.src})`);
  console.log(`    fen: ${f.fenBefore}`);
  if (f.masters) console.log(`    masters: scripted move ${f.masters.scriptedShare}% of ${f.masters.total} games | top: ${(f.masters.top || []).join(", ")}${f.masters.error ? " ERR " + f.masters.error : ""}`);
}
const clear = results.filter((r) => r.delta <= THRESHOLD);
console.log(`\nclear: ${clear.length} | worst clear margins:`);
for (const r of [...clear].sort((a, b) => b.delta - a.delta).slice(0, 8)) console.log(`  ${r.san} [${chip(r.packId)}] Δ${r.delta}cp (${r.src})`);
const localOnly = results.filter((r) => r.src.startsWith("local"));
if (CLOUD && localOnly.length) console.log(`cloud had no data for ${localOnly.length} position(s) (local fallback): ${localOnly.map((r) => r.san).join(", ")}`);
