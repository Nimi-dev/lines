/* Real-game analysis: walk chess.com games against the repertoire tree.
   Pure logic — no fetch, no React — so tools/games-test.mjs can verify it.

   Every 1.e4 game ends in exactly one bucket:
   - "user":  you left book first (recall failure or pre-training habit)
   - "opp":   the opponent left the tree (a coverage event, not a knowledge event)
   - "done":  the game ran through a scripted line to its end (covered)
   Coverage is conditioned on your positions: it asks how far the OPPONENT
   stays scripted, estimated per opponent-node from your own games and
   multiplied down the tree. */

const clean = (s) => (s || "").replace(/^\d+\.+/, "").replace(/[!?]+$/, "").replace(/[+#]/g, "");

/* PGN movetext -> SAN list (chess.com PGNs carry {[%clk]} comments) */
export const sanList = (pgn) => {
  const parts = (pgn || "").split(/\n\n/);
  const mt = parts.length > 1 ? parts.slice(1).join("\n\n") : parts[0] || "";
  return mt
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\b\d+\.(\.\.)?/g, " ")
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, "")
    .trim().split(/\s+/).filter(Boolean);
};

/* one game vs the tree; sans is the game's SAN list, from ply 0 */
export const walkGame = (tree, sq, posKey, START, sans, userPly = 0) => {
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  let b = START.slice(), k = 0;
  while (k < sans.length) {
    const key = posKey(b, k % 2);
    const gs = clean(sans[k]);
    if (k % 2 === userPly) {
      const u = tree.REP.user[key];
      if (!u) return { kind: "done", ply: k, key };
      if (clean(u.san) !== gs) return { kind: "user", ply: k, key, expected: u.san, played: sans[k] };
      b = applyTok(b, u.m);
    } else {
      const opp = (tree.REP.opp[key] || []).find((x) => clean(x.san) === gs);
      if (!opp) {
        if (!(tree.REP.opp[key] || []).length) return { kind: "done", ply: k, key };
        return { kind: "opp", ply: k, key, played: sans[k] };
      }
      b = applyTok(b, opp.m);
    }
    k++;
  }
  return { kind: "done", ply: k, key: null, inBookAtEnd: true };
};

const isWin = (r) => r === "win";
const isDraw = (r) => ["stalemate", "repetition", "agreed", "insufficient", "timevsinsufficient", "50move"].includes(r);
export const scorePct = (games) => {
  if (!games.length) return null;
  const s = games.reduce((a, g) => a + (isWin(g.r) ? 1 : isDraw(g.r) ? 0.5 : 0), 0);
  return Math.round((100 * s) / games.length);
};

/* node-product coverage: per opponent-node empirical stay-rate from the games
   that reached it; thin nodes (n < minN) borrow the global scripted-stay rate. */
export const analyzeGames = (tree, helpers, games, opts = {}) => {
  const { sq, posKey, START } = helpers;
  const minN = opts.minN || 8;
  const userPly = opts.side === "black" ? 1 : 0;
  const recentMs = opts.now ? opts.now - 30 * 86400000 : Date.now() - 30 * 86400000;

  // pool: as White, games where the user opened with the tree's move (1.e4);
  // as Black, every game — the root is an opponent node, so all games enter.
  const mine = games.filter((g) => (userPly === 0 ? g.white : !g.white));
  const e4 = userPly === 0 ? mine.filter((g) => clean(g.s[0]) === "e4") : mine;

  // walk every game; also log the opponent's reply at every opp-node reached
  const nodeSeen = {}, nodeStay = {}, nodeLeaks = {}, nodePly = {}, nodeMove = {}; // key -> counts
  const buckets = { user: [], opp: [], done: [] };
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  for (const g of e4) {
    // node stats: follow the game while the USER is in book; record opp replies
    let b = START.slice(), k = 0;
    while (k < g.s.length) {
      const key = posKey(b, k % 2);
      const gs = clean(g.s[k]);
      if (k % 2 === userPly) {
        const u = tree.REP.user[key];
        if (!u) break;
        if (clean(u.san) !== gs) break; // conditioned on your positions: past your deviation the branch is unobservable
        b = applyTok(b, u.m);
      } else {
        const entry = tree.REP.opp[key] || [];
        if (!entry.length) break;
        nodeSeen[key] = (nodeSeen[key] || 0) + 1; nodePly[key] = k;
        const opp = entry.find((x) => clean(x.san) === gs);
        if (!opp) {
          nodeLeaks[key] = nodeLeaks[key] || {};
          const lk = nodeLeaks[key][gs] = nodeLeaks[key][gs] || { n: 0, games: [] };
          lk.n++; if (lk.games.length < 4) lk.games.push(g);
          break;
        }
        nodeStay[key] = (nodeStay[key] || 0) + 1;
        nodeMove[key] = nodeMove[key] || {};
        nodeMove[key][gs] = (nodeMove[key][gs] || 0) + 1;
        b = applyTok(b, opp.m);
      }
      k++;
    }
    const out = walkGame(tree, sq, posKey, START, g.s, userPly);
    buckets[out.kind].push({ g, out });
  }

  // depth-aware prior: stay-rates rise with depth (an opponent five plies into
  // book rarely leaves next move). A thin node at ply p borrows the aggregate
  // stay of the deepest measurable ply <= p, never a shallower one's average.
  const plyAgg = {}; // ply -> {stay, seen}
  let thickStay = 0, thickSeen = 0;
  for (const key of Object.keys(nodeSeen)) {
    if (nodeSeen[key] < minN) continue;
    const pl = nodePly[key];
    plyAgg[pl] = plyAgg[pl] || { stay: 0, seen: 0 };
    plyAgg[pl].stay += nodeStay[key] || 0; plyAgg[pl].seen += nodeSeen[key];
    thickStay += nodeStay[key] || 0; thickSeen += nodeSeen[key];
  }
  const thickPlies = Object.keys(plyAgg).map(Number).sort((a, b) => a - b);
  const priorStay = thickSeen ? thickStay / thickSeen : 0.6;
  const priorAt = (ply) => {
    let best = null;
    for (const pl of thickPlies) if (pl <= ply) best = pl;
    if (best == null) return priorStay;
    // shrink the ply aggregate toward the global rate: a single narrow node can
    // dominate a deep ply's aggregate (e.g. one thick node with stay 2/8) and
    // would otherwise poison every deeper thin node's prior with its leak
    const a = plyAgg[best];
    return (a.stay + 12 * priorStay) / (a.seen + 12);
  };

  // stay-rate with continuous shrinkage toward the depth prior — no thick/thin
  // cliff, and no single narrow node can dominate an estimate
  const stayAt = (key, k) => {
    const n = nodeSeen[key] || 0;
    return ((nodeStay[key] || 0) + 6 * priorAt(k)) / (n + 6);
  };
  // coverage(depth): P(the opponent's replies all stay scripted through `depth`
  // plies), node-product over the tree. Full-line completion is the wrong yard-
  // stick for the value proposition — the +1 is banked by ~your 6th move, while
  // scripted lines run to move 9-11 tabiyas — so the headline is coverage@12
  // plies and the full curve is reported alongside.
  const coverTo = (limit) => {
    const memo = {};
    const cover = (b, k) => {
      if (k >= limit) return 1;
      const key = posKey(b, k % 2);
      if (memo[key] != null) return memo[key];
      let v;
      if (k % 2 === userPly) {
        const u = tree.REP.user[key];
        v = u ? cover(applyTok(b, u.m), k + 1) : 1;
      } else {
        const entry = tree.REP.opp[key] || [];
        if (!entry.length) v = 1;
        else {
          const stay = stayAt(key, k);
          const mv = nodeMove[key] || {};
          const totalObs = Object.values(mv).reduce((a, x) => a + x, 0);
          let acc = 0;
          for (const e of entry) {
            const child = cover(applyTok(b, e.m), k + 1);
            const c = mv[clean(e.san)] || 0;
            const w = (c + 0.5) / (totalObs + 0.5 * entry.length); // smoothed share
            acc += w * child;
          }
          v = stay * acc;
        }
      }
      memo[key] = v; return v;
    };
    return cover(START.slice(), 0);
  };
  const coverageCurve = { 6: coverTo(6), 8: coverTo(8), 10: coverTo(10), 12: coverTo(12), full: coverTo(99) };
  const coverage = coverageCurve[12];

  // direct empirical coverage (games that ran to a terminal among resolved games)
  const resolved = buckets.opp.length + buckets.done.length;
  const coveredDirect = resolved ? buckets.done.length / resolved : null;

  // leaks ranked by frequency x score deficit
  const leaks = [];
  for (const key of Object.keys(nodeLeaks)) {
    for (const [move, rec] of Object.entries(nodeLeaks[key])) {
      const gs2 = buckets.opp.filter((x) => x.out.key === key && clean(x.out.played) === move).map((x) => x.g);
      const sc = scorePct(gs2);
      leaks.push({ key, move, ply: nodePly[key], n: rec.n, mass: e4.length ? rec.n / e4.length : 0, score: sc,
        ev: rec.n * Math.max(0, (52 - (sc == null ? 52 : sc)) / 100) });
    }
  }
  leaks.sort((a, b) => (b.ev - a.ev) || (b.n - a.n));

  // per-run path probability: how often this exact line happens in YOUR pool
  // (product of the opponent's move-shares along the path; add-half smoothing at
  // thick nodes so unobserved scripted replies stay possible, priors at thin ones)
  const runProb = {};
  if (tree.RUNS) {
    for (const r of tree.RUNS) {
      let b = START.slice(), p = 1;
      const cap = Math.min(r.toks.length, 13); // frequency through the teaching zone, not the full tabiya
      for (let k = 0; k < cap; k++) {
        const key = posKey(b, k % 2);
        if (k % 2 !== userPly) {
          const entry = tree.REP.opp[key] || [];
          const mv = nodeMove[key] || {};
          const totalObs = Object.values(mv).reduce((a, x) => a + x, 0);
          const c = mv[clean(r.sans[k])] || 0;
          p *= stayAt(key, k) * ((c + 0.5) / (totalObs + 0.5 * Math.max(1, entry.length)));
        }
        b = applyTok(b, r.toks[k]);
      }
      runProb[r.sig] = p;
    }
  }

  // your misses on tree positions
  const missMap = {};
  for (const { g, out } of buckets.user) {
    const id = out.key + "|" + clean(out.expected);
    const m = missMap[id] = missMap[id] || { key: out.key, expected: out.expected, ply: out.ply, plays: {}, n: 0, recent: 0, urls: [] };
    m.n++; if ((g.t || 0) * 1000 >= recentMs) m.recent++;
    const pl = clean(out.played);
    m.plays[pl] = (m.plays[pl] || 0) + 1;
    if (m.urls.length < 3 && g.url) m.urls.push(g.url);
  }
  const misses = Object.values(missMap).sort((a, b) => b.recent - a.recent || b.n - a.n);

  return {
    totals: { games: games.length, mine: mine.length, e4: e4.length,
      user: buckets.user.length, opp: buckets.opp.length, done: buckets.done.length },
    coverage, coverageCurve, coveredDirect, priorStay,
    scores: { user: scorePct(buckets.user.map((x) => x.g)), opp: scorePct(buckets.opp.map((x) => x.g)), done: scorePct(buckets.done.map((x) => x.g)) },
    leaks, misses, runProb,
  };
};

/* recommender: which leaks would a not-yet-learned pack absorb? */
export const packGains = (currentTree, candidateTrees, leaks) => {
  return candidateTrees.map(({ id, tree }) => {
    let n = 0; const covers = [];
    for (const L of leaks) {
      const entry = (tree.REP.opp[L.key] || []);
      if (entry.some((e) => clean(e.san) === L.move) && !(currentTree.REP.opp[L.key] || []).some((e) => clean(e.san) === L.move)) {
        n += L.n; covers.push(L.move);
      }
    }
    return { id, n, covers };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
};

/* ---- v6.8 evaluation page machinery ---- */

/* the learned subtree as a walkable rep: only positions/moves along runs the
   user has actually learned. Corpus-vs-learned walks give different break
   points — one gap is fixed by learning, the other by authoring. */
export const buildLearnedRep = (runs, learnedSigs, helpers) => {
  const { sq, posKey, START } = helpers;
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  const user = {}, opp = {};
  for (const r of runs) {
    if (!learnedSigs[r.sig]) continue;
    const userPly = r.side === "black" ? 1 : 0;
    let b = START.slice();
    for (let k = 0; k < r.toks.length; k++) {
      const key = posKey(b, k % 2);
      if (k % 2 === userPly) user[key] = { m: r.toks[k], san: r.sans[k] || "" };
      else {
        const e = (opp[key] = opp[key] || []);
        if (!e.some((x) => x.m === r.toks[k])) e.push({ m: r.toks[k], san: r.sans[k] || "" });
      }
      b = applyTok(b, r.toks[k]);
    }
  }
  return { user, opp };
};

/* walk one game against a rep, returning the break with enough state to EVAL
   the last in-book position: its board, applied tree tokens (for castling
   rights in the FEN), ply, kind (user|opp|done), and the moves involved.
   kind "done": the book outlived the game or the line completed. */
export const walkBreak = (rep, helpers, sans, userPly = 0) => {
  const { sq, posKey, START } = helpers;
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  let b = START.slice(), k = 0;
  const hist = [];
  while (k < sans.length) {
    const key = posKey(b, k % 2);
    const gs = clean(sans[k]);
    if (k % 2 === userPly) {
      const u = rep.user[key];
      if (!u) return { kind: "out", ply: k, key, board: b, hist };
      if (clean(u.san) !== gs) return { kind: "user", ply: k, key, board: b, hist, expected: u.san, played: sans[k] };
      b = applyTok(b, u.m); hist.push(u.m);
    } else {
      const entry = rep.opp[key] || [];
      if (!entry.length) return { kind: "out", ply: k, key, board: b, hist };
      const opp = entry.find((x) => clean(x.san) === gs);
      if (!opp) return { kind: "opp", ply: k, key, board: b, hist, played: sans[k] };
      b = applyTok(b, opp.m); hist.push(opp.m);
    }
    k++;
  }
  return { kind: "done", ply: k, key: posKey(b, k % 2), board: b, hist, inBookAtEnd: true };
};

/* aggregate a window of per-game breakdowns: milestone survival at moves 5/7/10
   (both denominators), median exit move, and eval-based goal stats where the
   caller supplies userPovCp per game (null while the engine is still thinking). */
export const aggregateWindow = (rows) => {
  const out = { n: rows.length, corpus: {}, learned: {}, edge: {} };
  for (const scope of ["corpus", "learned"]) {
    const moves = rows.map((r) => Math.floor(r[scope].ply / 2));
    const at = (m) => (rows.length ? Math.round((100 * moves.filter((x) => x >= m).length) / rows.length) : 0);
    const sorted = [...moves].sort((a, b) => a - b);
    out[scope] = { at5: at(5), at7: at(7), at10: at(10),
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      userBreaks: rows.filter((r) => r[scope].kind === "user").length,
      oppBreaks: rows.filter((r) => r[scope].kind === "opp").length,
      out: rows.filter((r) => r[scope].kind === "out").length,
      done: rows.filter((r) => r[scope].kind === "done").length };
  }
  const evald = rows.filter((r) => r.userPovCp != null);
  const oppExits = evald.filter((r) => r.learned.kind !== "user");
  const goal = oppExits.filter((r) => r.userPovCp >= 100);
  const isWinR = (r) => r.g.r === "win";
  out.edge = {
    evald: evald.length,
    avgCp: evald.length ? Math.round(evald.reduce((a, r) => a + r.userPovCp, 0) / evald.length) : null,
    goalN: goal.length, oppExitN: oppExits.length,
    goalRate: oppExits.length ? Math.round((100 * goal.length) / oppExits.length) : null,
    conversion: goal.length ? Math.round((100 * (goal.filter(isWinR).length + 0.5 * goal.filter((r) => isDraw(r.g.r)).length)) / goal.length) : null,
  };
  return out;
};
