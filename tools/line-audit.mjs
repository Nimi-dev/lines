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

// Deliberate keeps: moves the engine scores a shade below its favourite that we
// ship anyway, on the record, because they are sound, winning and simpler to
// teach. Listed here so an audit reports them as accepted rather than as news —
// and so nobody silently "fixes" one. A stale entry fails the run.
const KEEPS = [
  { packId: "steinitz", san: "8.bxc3", why: "recapture toward the center opens the b-file at the cost of ~a pawn-fraction; the file is the plan" },
  { packId: "steinitz", san: "9.Bd3!", why: "edge-case tempo move on the queen; engine prefers a quieter square, we prefer the initiative" },
  { packId: "declines", san: "8.Nc3", why: "prepares O-O-O+ developing a rook with check; engine's alternative is fractionally better and harder to teach" },
];
const isKeep = (r) => KEEPS.find((k) => k.packId === r.packId && k.san === r.san);

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

// A drop from +7.5 to +5.9 is not a finding: both positions are winning by a
// queen and the delta is engine noise about how fast to convert. Only judge
// moves that actually change what the position IS.
const DECISIVE = 300;
const overThreshold = results.filter((r) => r.delta > THRESHOLD).sort((a, b) => b.delta - a.delta);
const stillWinning = overThreshold.filter((r) => r.evalAfter > DECISIVE);
const flagged = overThreshold.filter((r) => !isKeep(r) && r.evalAfter <= DECISIVE);
const keptFlagged = overThreshold.filter((r) => isKeep(r) && r.evalAfter <= DECISIVE);

// the registry must describe moves that actually exist in the tree
const keepMatches = (k) => results.filter((r) => r.packId === k.packId && r.san === k.san);
// one SAN can occur in two positions of the same pack (Steinitz plays 8.bxc3 in
// both the dream and the edge line) — say so, or a real flag hides behind a keep
for (const k of KEEPS) {
  const ms = keepMatches(k);
  if (ms.length > 1) console.log(`  note: keep ${k.packId} ${k.san} matches ${ms.length} positions (Δ ${ms.map((m) => m.delta).join(", ")}cp) — both are covered by this entry`);
}
const missing = KEEPS.filter((k) => !keepMatches(k).length);
if (missing.length) {
  console.error(`\nSTALE KEEPS REGISTRY: ${missing.map((k) => k.packId + " " + k.san).join(", ")} no longer in the tree.`);
  console.error("Update the KEEPS list in tools/line-audit.mjs (and the constitution) before shipping.");
  process.exitCode = 1;
}
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

if (keptFlagged.length) {
  console.log(`\n${keptFlagged.length} deliberate keep(s) over threshold — accepted, on the record:`);
  for (const k of keptFlagged) console.log(`  ${k.san} [${chip(k.packId)}] Δ${k.delta}cp — ${isKeep(k).why}`);
}
const keepsNowClear = KEEPS.filter((k) => results.some((r) => r.packId === k.packId && r.san === k.san && r.delta <= THRESHOLD));
if (keepsNowClear.length) console.log(`\n${keepsNowClear.length} keep(s) no longer over threshold at this depth: ${keepsNowClear.map((k) => k.san).join(", ")}`);

if (stillWinning.length) {
  console.log(`\n${stillWinning.length} over threshold but still winning after the move (>${DECISIVE}cp) — conversion speed, not soundness:`);
  for (const r of stillWinning) console.log(`  ${r.san} [${chip(r.packId)}] ${r.evalBefore} → ${r.evalAfter} (Δ${r.delta})`);
}

console.log(`\n${flagged.length} flagged of ${results.length} (keeps and decisive positions excluded):`);
for (const f of flagged) {
  console.log(`  ${f.san} [${chip(f.packId)}] loses ${f.delta}cp (before ${f.evalBefore} → after ${f.evalAfter}, ${f.src})`);
  console.log(`    fen: ${f.fenBefore}`);
  if (f.masters) console.log(`    masters: scripted move ${f.masters.scriptedShare}% of ${f.masters.total} games | top: ${(f.masters.top || []).join(", ")}${f.masters.error ? " ERR " + f.masters.error : ""}`);
}
const clear = results.filter((r) => r.delta <= THRESHOLD);
console.log(`\nclear: ${clear.length} | worst clear margins:`);
for (const r of [...clear].sort((a, b) => b.delta - a.delta).slice(0, 8)) console.log(`  ${r.san} [${chip(r.packId)}] Δ${r.delta}cp (${r.src})`);
const localOnly = results.filter((r) => r.src.startsWith("local"));
if (!CLOUD) console.log(`\nNOTE: local engine only — it reaches depth ~7 here and systematically undervalues quiet structural moves.\nRun with --cloud (Lichess cloud Stockfish, depth 20+) before shipping any content change; it is the arbiter that caught 10.Qe4?.`);
if (CLOUD && localOnly.length) console.log(`cloud had no data for ${localOnly.length} position(s) (local fallback): ${localOnly.map((r) => r.san).join(", ")}`);
