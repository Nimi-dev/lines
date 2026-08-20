// Line audit: engine-check every scripted White move in the repertoire tree.
// For each user position: eval(position) vs eval(after scripted move) — a large
// drop means the scripted move loses value vs best play. Flagged moves are
// cross-checked against the Lichess masters database (--masters) before being
// treated as errors: a common master move is book, not a blunder.
// Usage: node tools/line-audit.mjs [--ms 2500] [--threshold 70] [--masters]
import { loadApp } from "./_load.mjs";
import { createRequire } from "node:module";

const { engineCore, START, sq, posKey, toFEN, PACKS, buildTree, CORE_PACK_IDS, LEARNABLE_PACK_IDS, BLACK_PACK_IDS } = await loadApp();

/* deliberate keeps (doctrine: waive in writing) — engine-suboptimal or unsound
   by design, verified by deep engine and documented. Flags matching these keys
   are reported as WAIVED, not failures. */
const LINE_WAIVERS = {
  // — chosen weapons (the user's explicit policy: best move unless a trap is chosen on purpose) —
  "alien|5.Neg5!?": "the trap's entry move — intentionally speculative (see 6.Nxf7!! waiver)",
  "alien|6.Nxf7!!": "SF d42: -162cp vs -18cp for 6.Nf3 — knowing, labeled trap weapon; edge line covers the correct defense",
  "alien|7.Nf3!": "inside the sacrifice's compensation phase — position already objectively Black's by design",
  "alien|9.Bd3": "Δ34 at d18 vs the same-idea 9.Qd3 — battery order, noise-adjacent, keeps the pack's bishop geometry",
  "alien|10.Ng6!": "the designed knight-journey (Ng6-xe7/xc8 eats the bishops); engine's 10.O-O banks ~+0.9 but abandons the pack's entire narrative in a branch reached only through Black's scripted errors",
  "alien|11.Nxe7": "continuation of the knight-journey — see 10.Ng6! waiver",
  "alien|12.Nxc8": "completes the journey at +3.7; engine's 12.Nxg6 is 26cp 'better' in an already-won branch",
  "alien|12.Qe2": "compensation phase of the documented sacrifice; no cloud data (local d~8 only)",
  // — teachability keeps (sound, winning, simpler than the engine's preference) —
  "steinitz|8.bxc3": "sound (+63) simple recapture kept over the engine's 8.Nf5 zwischenzug (+166) — teachability",
  "steinitz|9.Bd3!": "keeps +305 of +408 — winning either way, thematic queen-kick",
  "steinitz|7.O-O": "book-safe castling (+61) kept over the engine's razor 7.Ndf5 (+120) in an edge line — king safety as the teachable theme",
  "declines|8.Nc3": "keeps +27 of +101 — the pack's O-O-O+ payoff requires it; sound and simple",
  "declines|4.dxe5": "the pack's premise (queen-trade endgame arc); engine's 4.d5 space-grab is +38cp and a different opening",
  "hoover|7.Bg5!": "mainline theory and the pack's Bg5/O-O-O theme; Δ45 to the engine's 7.Bf4 at d18",
  "philidor|6.Be2": "system development in the honest-road edge; Δ31 ≈ noise",
  "philidor|6.Bc4": "the Opera Game move order — Bc4 before Qb3 is the pack's two-barrel payoff; Δ27 ≈ noise",
  // — won-position noise (engine flip-flops between equally winning moves) —
  "petroff|7.d4": "queen-up (+4.6) — engine 'prefers' 7.Qd1 by 66cp of +5.2; development kept over retreat",
  "petroff|7.Qd1!": "queen-up (+4.9) — engine 'prefers' 7.d4 by 47cp of +5.4; the consolidation lesson kept (mirror of the 7.d4 waiver: at +5 the engine's ordering is noise)",
  // — black-side keeps —
  "morra|2.d4!?": "the gambit's front door — chosen weapon per the coverage policy",
  "morra|3.c3!": "the gambit proper: SF prefers 3.Nf3 (+26 vs -15) — a knowing, labeled practical weapon like the Alien; the danger line covers declines",
  "morra|10.Nxf7": "the pack's fork payoff; SF prefers 10.Bxf7+ (+137 vs +16) at d18 — chosen-weapon keep, flagged for a content-revision brief",
  "kpawn|2...Bc5!": "KGD decline: accepting is 52cp 'better' and twenty moves of theory; declining is solid and carries the built-in 3.fxe5?? Qh4+! refutation — the pack's own why-block documents this choice",
  "kpawn|7...b5!": "keeps -341 of -433 — the classic piece-winning fork, simplest to teach; SF's alternative is more crushing but needlessly complex",
};

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? +args[i + 1] : dflt; };
const MS = opt("ms", 2500), THRESHOLD = opt("threshold", 70), MASTERS = args.includes("--masters");
const CLOUD = args.includes("--cloud"); // arbitrate every position with Lichess cloud Stockfish (deep) — the local engine misses deep refutations (10.Qe4? was Δ40 "clear" locally and −344cp at depth 23)
const SF = args.includes("--sf"), DEPTH = opt("depth", 20); // local Stockfish (npm i -D stockfish) — deep, offline, no rate limit
const BEST = args.includes("--best"); // policy: every scripted move must BE the engine's best (co-best within NOISE passes); else fix or written waiver
const NOISE = opt("noise", 25);

/* The strongest arbiter available wins: sf > cloud > the in-app engineCore.
   engineCore is NOT an arbiter — it reaches ~depth 7 and cleared 10.Qe4? at
   Δ40 when the truth was −344cp at depth 23. */
const sfEngine = await (async () => {
  if (!SF) return null;
  try {
    const require = createRequire(import.meta.url);
    const engine = await require("stockfish")("lite-single");
    const realWrite = process.stdout.write.bind(process.stdout);
    let onLine = null;
    const isUci = (t) => /^(info\b|bestmove\b|Stockfish \d|id \w|option name|uciok|readyok)/.test(t.trimStart());
    process.stdout.write = (chunk) => {
      const t = String(chunk);
      if (!isUci(t)) return realWrite(chunk);
      if (onLine) onLine(t);
      return true;
    };
    const evalFen = (fen) => new Promise((resolve) => {
      let score = null;
      onLine = (t) => {
        const m = t.match(/^info .*\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)/);
        if (m && +m[1] >= DEPTH) score = m[2] === "mate" ? { mate: +m[3] } : { cp: +m[3] };
        const bm = t.match(/^bestmove\s+(\S+)/);
        if (bm) resolve(score ? { ...score, best: bm[1] } : null);
      };
      engine.sendCommand("ucinewgame");
      engine.sendCommand("position fen " + fen);
      engine.sendCommand("go depth " + DEPTH);
    });
    return {
      // UCI reports side-to-move POV; this audit works in White POV
      eval: async (fen) => {
        const r = await evalFen(fen);
        if (!r) return null;
        const w = fen.split(/\s+/)[1] === "w" ? 1 : -1;
        return r.mate != null ? { mate: r.mate * w, best: r.best } : { cp: r.cp * w, best: r.best };
      },
      close: () => { process.stdout.write = realWrite; },
    };
  } catch (e) {
    console.error(`--sf requested but the stockfish package is unavailable (${e.message}).`);
    console.error("Install it with:  npm i -D stockfish     (optional; without it the audit falls back to the weak local engine)");
    process.exit(1);
  }
})();

const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
const cp = (r) => (r.mate != null ? (r.mate > 0 ? 30000 - r.mate : -30000 - r.mate) : r.cp);

// collect unique user positions with a concrete history (for castling rights in the FEN)
const seen = new Map(); // key -> {b, hist, k, san, m, packId, side}
const collect = (tree, side) => {
  const userPly = side === "black" ? 1 : 0;
  for (const pt of tree.REPX.paths) {
    let b = START.slice();
    const hist = [];
    for (let k = 0; k < pt.toks.length; k++) {
      const key = posKey(b, k % 2);
      if (k % 2 === userPly && tree.REP.user[key] && !seen.has(key)) {
        seen.set(key, { b: b.slice(), hist: hist.slice(), k, san: tree.REP.user[key].san, m: tree.REP.user[key].m, packId: tree.REP.user[key].packId, side });
      }
      b = applyTok(b, pt.toks[k]);
      hist.push(pt.toks[k]);
    }
  }
};
collect(buildTree([...CORE_PACK_IDS, ...LEARNABLE_PACK_IDS]), "white");
collect(buildTree(BLACK_PACK_IDS, "black"), "black");
console.log(`auditing ${seen.size} unique scripted user positions, both sides (movetime ${MS}ms, threshold ${THRESHOLD}cp)…`);

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
  let evalBefore, evalAfter, src = "local", engineBest = null, isBest = false;
  if (sfEngine) {
    const b = await sfEngine.eval(fenBefore);
    if (b) engineBest = b.best || null;
    if (b && sameMove(b.best, pos.m)) {
      evalBefore = cp(b); evalAfter = cp(b); src = "sf d" + DEPTH + " (best)"; isBest = true;
    } else {
      const a = await sfEngine.eval(fenAfter);
      if (b && a) { evalBefore = cp(b); evalAfter = cp(a); src = "sf d" + DEPTH; }
    }
  }
  if (evalBefore == null && CLOUD) {
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
  // cp given up vs best play, from the USER's point of view (cloud cp is White-POV)
  const delta = pos.side === "black" ? evalAfter - evalBefore : evalBefore - evalAfter;
  results.push({ key, ...pos, fenBefore, evalBefore, evalAfter, delta, src, engineBest, isBest });
  process.stdout.write(isBest ? "*" : ".");
}
console.log("");

if (BEST) {
  const bests = results.filter((r) => r.isBest).length;
  const coBest = results.filter((r) => !r.isBest && r.delta <= NOISE);
  const dev = results.filter((r) => !r.isBest && r.delta > NOISE).sort((a, b) => b.delta - a.delta);
  const chip2 = (id) => (PACKS.find((p) => p.id === id) || {}).chip || id;
  console.log(`\nBEST-MOVE POLICY: ${bests}/${results.length} scripted moves ARE the engine's best; ${coBest.length} co-best within ${NOISE}cp.`);
  if (dev.length) {
    console.log(`${dev.length} deviations (fix or waive):`);
    for (const r of dev) {
      const w = LINE_WAIVERS[r.packId + "|" + r.san];
      console.log(`  ${w ? "~" : "!"} ${r.san} [${chip2(r.packId)}] Δ${r.delta}cp — engine prefers ${r.engineBest || "?"} (${r.evalBefore} vs ${r.evalAfter})${w ? " — WAIVED" : ""}`);
      if (!w) console.log(`      fen: ${r.fenBefore}`);
    }
  }
}

const clean2 = (x) => x; // keep key format literal: packId|san
if (sfEngine) sfEngine.close();
if (!SF && !CLOUD) console.log("\nNOTE: local engineCore only (~depth 7) — not an arbiter. Re-run with --sf (local Stockfish) or --cloud before shipping content.");

const allFlagged = results.filter((r) => r.delta > THRESHOLD).sort((a, b) => b.delta - a.delta);
const waivedFlags = allFlagged.filter((r) => LINE_WAIVERS[r.packId + "|" + r.san]);
const flagged = allFlagged.filter((r) => !LINE_WAIVERS[r.packId + "|" + r.san]);
const chip = (id) => (PACKS.find((p) => p.id === id) || {}).chip || id;
if (waivedFlags.length) {
  console.log(`\n${waivedFlags.length} waived (documented deliberate keeps):`);
  for (const f of waivedFlags) console.log(`  ~ ${f.san} [${chip(f.packId)}] Δ${f.delta}cp — ${LINE_WAIVERS[f.packId + "|" + f.san]}`);
}

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
