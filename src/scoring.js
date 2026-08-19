/* v6.3 memory model — two-variable, performance-gated.
   Per the design brief: storage strength is a half-life H (days); retrieval
   strength is predicted retrievability R = 2^(−Δ/H). The stability gain on a
   successful hand-play is indexed on the model's own prediction at test time
   (E += g·(1−R)): a same-minute repeat earns ~nothing (predicted ≈1), a cold
   or vacation-return recall earns the most — desirable difficulty, derived
   rather than tuned. Misses shrink H multiplicatively. Fast-forward is gated
   purely on R ≥ OWN — no calendar gates; time is only for decay.

   Derived properties (machine-checked in tools/scoring-test.mjs):
   - a first-ever success ("cold ✓", possibly a guess) decays below OWN by
     roughly the next day, forcing one spaced confirmation;
   - guessing right twice spaced is ~6% (0.25²) — the identifiability bound;
   - the same-day seven-reps complaint: repeats within minutes gain ≈0. */

export const MEM = {
  H0: 1.0,     // half-life (days) granted by a first-ever success — owned for ~7.7h, below OWN by next morning
  KG: 2.2,     // stability gain scale: H *= 1 + KG·(1−R) on success
  SHRINK: 0.25, // H *= SHRINK on a miss
  HMIN: 0.08,  // H floor after misses (~2h)
  OWN: 0.8,    // R at or above this = owned: eligible to fast-forward
  EV_CAP: 48,  // events kept per position (newest last)
};

/* predicted retrievability now; 0 for never-tested positions */
export const retrievability = (rec, now) =>
  rec && rec.H > 0 && rec.last ? Math.pow(2, -((now - rec.last) / 86400000) / rec.H) : 0;

/* the fast-forward gate: owned = predicted retrievable AND not in relearn.
   A miss opens relearn; only a clean hand-play closes it — so a missed
   position is always re-proven by hand, never fast-forwarded on a technicality. */
export const owned = (rec, now) => !!rec && !rec.relearn && retrievability(rec, now) >= MEM.OWN;

/* fold one hand-play outcome into a position record.
   Returns { rec, R, cracked }: R is the prediction at test time; cracked is
   a miss on ground the model called owned — the serious flag. */
export const foldResult = (rec, clean, now, door, latMs) => {
  const r0 = rec || { H: 0, last: 0, seen: 0, miss: 0, cracks: 0, via: {}, ev: [] };
  const R = retrievability(r0, now);
  const cracked = !clean && R >= MEM.OWN;
  const H = clean
    ? (r0.H > 0 ? r0.H * (1 + MEM.KG * (1 - R)) : MEM.H0)
    : Math.max(MEM.HMIN, (r0.H || MEM.H0) * MEM.SHRINK);
  const via = { ...(r0.via || {}) };
  if (door) { const e = via[door] || [0, 0]; via[door] = [e[0] + 1, e[1] + (clean ? 0 : 1)]; }
  const ev = [...(r0.ev || []), [Math.round(now / 60000), clean ? 1 : 0, door || "?",
    latMs != null ? Math.min(Math.round(latMs), 60000) : null]].slice(-MEM.EV_CAP);
  return {
    rec: { H, last: now, relearn: !clean, seen: (r0.seen || 0) + 1, miss: (r0.miss || 0) + (clean ? 0 : 1),
      cracks: (r0.cracks || 0) + (cracked ? 1 : 0), via, ev },
    R, cracked,
  };
};

/* best-effort seed from a v6.2 confidence score (import of old exports only) */
export const seedFromConf = (c, seen, miss, cracks, via, now) => ({
  H: c >= 0.8 ? 3 : Math.max(MEM.HMIN, c * 1.5),
  last: now, relearn: false, seen: seen || 0, miss: miss || 0, cracks: cracks || 0, via: via || {}, ev: [],
});
