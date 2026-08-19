/* Learn-flow logic (v6.4): every gauntlet run becomes a learnable LINE with a
   per-ply annotated document (walk phase) and a payoff explanation (why the end
   position is your +1). Pure functions — verified by tools/learn-test.mjs.

   Learned ≠ owned. "Learned" is a gate you pass once (one clean try) that
   admits the line to the daily gauntlet; "owned" is the live v6.3 memory
   prediction per position. Learning writes NO memory evidence — misses while
   learning are expected and must not count as recall failures. */

/* per-ply annotated document for a run.
   Annotations are looked up by POSITION + MOVE (like the tree itself), so
   transposition runs — whose toks don't follow the dream's move order — still
   find the note that was authored for each move wherever it occurs.
   Returns { plies: [{ san, m, note, why }] aligned with run.toks, payoff }. */
export const buildLineDoc = (pack, extras, run, helpers) => {
  const { sq, posKey, START } = helpers;
  const applyTok = (b, m) => { const nb = b.slice(); for (const g of m.split(",")) { const f = sq(g.slice(0, 2)), t = sq(g.slice(2, 4)); nb[t] = nb[f]; nb[f] = null; } return nb; };
  const ann = new Map(); // posKey|token -> { san, note, why }
  const annotate = (plies) => {
    let b = START.slice();
    plies.forEach((d, i) => {
      const key = posKey(b, i % 2) + "|" + d.m;
      const prev = ann.get(key);
      if (!prev || (!prev.note && d.note) || (!prev.why && d.why)) {
        ann.set(key, { san: d.san || (prev && prev.san) || "", note: d.note || (prev && prev.note) || "", why: d.why || (prev && prev.why) || null });
      }
      b = applyTok(b, d.m);
    });
  };
  const dream = pack.dream || [];
  annotate(dream);
  for (const f of ((extras && extras.futures) || [])) {
    annotate([...dream.map((d) => ({ m: d.m, san: d.san })), ...f.moves]);
  }
  const g = pack.danger;
  if (g) {
    const base = (g.base || dream.slice(0, g.baseCount).map((d) => d.m)).map((m, i) => (g.base ? { m, san: "" } : { m, san: dream[i].san, note: dream[i].note, why: dream[i].why }));
    annotate([...base, ...g.plies]);
  }
  // walk the run's actual toks against the annotation map
  let b = START.slice();
  const plies = run.toks.map((m, k) => {
    const a = ann.get(posKey(b, k % 2) + "|" + m) || {};
    b = applyTok(b, m);
    return { san: a.san || run.sans[k] || "", m, note: a.note || "", why: a.why || null };
  });
  // payoff: why the end position is your +1
  let payoff;
  if (run.kind === "future") {
    const fut = ((extras && extras.futures) || []).find((f) => f.t === run.t);
    payoff = { title: run.label, text: (fut && fut.note) || (extras && extras.finalWhy) || "" };
  } else if (run.kind === "edge") {
    const lastNote = g ? [...g.plies].reverse().find((p) => p.note) : null;
    payoff = { title: (g && g.headline) || run.label, text: (lastNote && lastNote.note) || (g && g.survival) || "" };
  } else {
    payoff = { title: "The payoff", text: (extras && extras.finalWhy) || (pack.promise && pack.promise.reveal) || "" };
  }
  return { plies, payoff };
};

/* clusters for the Learn page: WHITE side = scotch core + learnable defenses,
   BLACK side = (no packs yet). Each cluster lists its runs in gauntlet order. */
export const buildClusters = (packs, tree, corePackIds, learnablePackIds) => {
  const byPack = {};
  for (const r of tree.RUNS) { (byPack[r.packId] = byPack[r.packId] || []).push(r); }
  const cluster = (p, group) => ({ id: p.id, chip: p.chip, group, runs: byPack[p.id] || [] });
  const white = [
    ...packs.filter((p) => corePackIds.includes(p.id)).map((p) => cluster(p, "Scotch core")),
    ...packs.filter((p) => learnablePackIds.includes(p.id)).map((p) => cluster(p, "Other defenses")),
  ];
  return { white, black: [] };
};

/* run status for the Learn page and gauntlet gating */
export const runStatus = (run, learnState, mem, retrievability, owned, now) => {
  const learned = !!(learnState.learned || {})[run.sig];
  const walked = !!(learnState.walked || {})[run.sig];
  const own = run.userKeys.filter((k) => owned(mem[k], now)).length;
  const rMin = run.userKeys.length
    ? Math.min(...run.userKeys.map((k) => retrievability(mem[k], now)))
    : 0;
  return { learned, walked, ownedN: own, total: run.userKeys.length, rMin };
};

/* grandfather clause: a run counts as learned when practice history proves it —
   any recorded day-play of its sig, or memory evidence on every position. */
export const grandfathered = (run, days, mem) => {
  for (const ds of Object.keys(days || {})) if (((days[ds] || {}).plays || {})[run.sig]) return true;
  return run.userKeys.length > 0 && run.userKeys.every((k) => mem[k] && (mem[k].seen || 0) > 0);
};

/* what to learn next: unlearned runs ranked by real-world frequency (runProb
   from the games analysis), falling back to gauntlet order. */
export const learnNext = (runs, learnState, runProb) => {
  const un = runs.filter((r) => !(learnState.learned || {})[r.sig]);
  if (!runProb) return un;
  return [...un].sort((a, b) => (runProb[b.sig] || 0) - (runProb[a.sig] || 0));
};

/* what to practice next: learned runs ranked by frequency × how far from owned */
export const practiceNext = (runs, learnState, mem, retrievability, runProb, now) => {
  const learned = runs.filter((r) => (learnState.learned || {})[r.sig]);
  const urgency = (r) => {
    const rMin = r.userKeys.length ? Math.min(...r.userKeys.map((k) => retrievability(mem[k], now))) : 0;
    return ((runProb && runProb[r.sig]) || 0.01) * (1 - rMin);
  };
  return [...learned].sort((a, b) => urgency(b) - urgency(a));
};
