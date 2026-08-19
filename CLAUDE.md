# CLAUDE.md — the lines constitution

**lines** is a chess opening trainer PWA: closed-world repertoire drilling
(Scotch as White + defensive shield), a daily gauntlet over 16 machine-verified
runs, per-position mastery scoring, and a built-in perft-verified engine.
Single-page React (Vite), no backend yet, persistence in localStorage behind
the `STORE` shim. Deploys automatically: merge to main → Cloudflare Pages.

## Laws (violations are bugs, no matter how pretty the code)

1. **One position → one move.** The entire tree guarantees a unique user move
   per position. Any content change must preserve this invariant — it is the
   validity condition for position-level scoring and run merging.
2. **Chess content is machine-verified, never trusted.** Every scripted line
   must pass the SEE audit; movegen changes must pass perft. Two shipped
   blunders (8.Nxe5??, 10.Bd3??) were caught by users — never again.
3. **`APP_VER` bumps on every shipped change** and renders in the footer.
   The stamp is how deploys are verified on-device. No silent versions.
4. **Storage schema changes ship with a migration.** User training history is
   sacred. The export/restore round-trip must never break — it is the user's
   backup across origins and the analysis interface.
5. **Verify patches structurally.** After any scripted/mechanical edit, grep
   for the anchor to confirm it landed. A stale anchor once silently shipped
   an old version while claiming a new one.

## Workflow

- Branch per task. Small, reviewable diffs. PR summary must state what was
  verified (which tools ran, what passed) — not just what changed.
- `npm test` green before any PR. CI enforces it; don't make CI the first run.
- Mechanism specs arrive as briefs from the design chat (the product's design
  room, which holds project memory). Implement briefs faithfully; flag
  disagreements in the PR rather than silently deviating.

## Design doctrine — for any mechanism NOT covered by a brief

Before implementing any scoring / scheduling / selection mechanism, red-team
your own proposal first and put the findings at the top of the PR:

- **Personas × scenarios**: the savant who already knows the lines, the novice,
  the 3-week-vacation returner, the binge player, the once-a-weeker, the
  95%-accurate sloppy tapper, the interference case. Write the expected
  behavior BEFORE running the mechanism against it. Grade against
  learning-per-minute with UX constraints — not raw user desire.
- **Cheapest exploit**: assume a user (or an optimizer) maximizing score
  without knowledge. Exposure loopholes, guessing, cramming.
- **Boundaries**: Δ→0, Δ→∞, long absence (the due-avalanche), clock skew,
  huge event vectors.
- **The five mandate questions**: Who has solved this before at industrial
  scale? What data already in the repo/logs could falsify this? What decision
  does the artifact actually drive — optimize that. What signals are we
  discarding? Which assumption is most likely false?

### The experiment-class checklist (from the design chat — run EVERY class)

Validation coverage must track a fixed taxonomy, not conversational salience —
whatever frame someone happens to utter is exactly the frame that over-gets
validated. De-leading by enumeration: the red-team stage runs this closed
checklist, and every mechanism addresses each class **or explicitly waives it
in writing**. Beyond personas, cheapest exploit, boundaries, invariance, and
incentives (above):

- **Null-model test** — must beat a dumb baseline ("everything resurfaces
  every 3 days flat"). If the trivial policy performs similarly, the
  complexity isn't paying rent.
- **Ablation** — delete each component (miss penalty, gap weighting, growing
  half-life); what breaks? Separates load-bearing from decorative.
- **Sensitivity sweep** — perturb every constant 2× each way; a design that
  only works at magic values is a coincidence, not a mechanism.
- **Identifiability** — can the mechanism distinguish the states it claims to
  measure from the signals it actually receives?
- **Second-order adaptation** — users learn the scoring and change behavior;
  does the mechanism stay valid once it's being gamed by habit rather than
  malice?
- **Pre-mortem** — it's November, the feature failed, users left; write the
  most plausible postmortem today.
- **Dirty-data robustness** — clock skew, duplicate events, lost writes (we
  lived this bug), offline replays.
- **Transplant test** — would it work for vocabulary or piano? Locates hidden
  chess-specific assumptions — which matters if the platform is the startup.
- **Explainability** — can we tell the user in one sentence why this position
  is due? Unexplainable scores leak trust.

A proposal without its failure analysis attached is incomplete by definition.

## Current model notes (v6.3 line)

- **The v6.3 memory model is live** (src/scoring.js, per the design-chat
  brief): per-position half-life H (storage strength) and predicted
  retrievability R = 2^(−Δ/H) (retrieval strength). Stability gain is indexed
  on the model's own prediction at test time — H *= 1 + g·(1−R) — so
  same-minute reps earn ≈0 and hard-won recalls earn the most (desirable
  difficulty, derived not tuned). A miss shrinks H and opens `relearn`; only a
  clean hand-play closes it. Fast-forward is purely performance-gated
  (owned = R ≥ 0.8 ∧ ¬relearn); there are no calendar gates. Seven derived
  properties are machine-checked in tools/scoring-test.mjs — keep them green.
- Evidence per position: arrival-door tags (`via`), and an event vector
  `[minuteEpoch, clean, door, latencyMs]` (capped, newest last). Latency is
  logged because fluency is a validated retrieval-strength proxy — a signal
  banked for the retrodiction harness (tools/retrodict.mjs), which horse-races
  scoring models as miss predictors on exported event history.
- **Known-false assumption on record**: positions are modeled as forgetting
  independently, but interference is real (the 8.Nc3 ghost). Not addressed in
  v6.3; any future fix must pass the checklist above.
- Sessions must stay time-efficient: target users are strong players who may
  already know lines. The app acknowledges demonstrated knowledge at the
  speed it is demonstrated; time is only for decay.
- Chess content answers to two machine gates: SEE audit (tools/see-audit.mjs,
  in CI) and the deep engine audit (tools/line-audit.mjs --cloud, run on any
  content change — it caught 10.Qe4?, which the shallow engine cleared).
  Three deliberate keeps are on record: 8.bxc3 / 9.Bd3! (Steinitz) and
  8.Nc3 (Declines) are engine-suboptimal by ~1 pawn-fraction but sound,
  winning, and simpler to teach than the engine's preference.
