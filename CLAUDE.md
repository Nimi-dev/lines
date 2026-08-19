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

A proposal without its failure analysis attached is incomplete by definition.

## Current model notes (v6.2 line)

- Mastery is per-position; evidence includes arrival-door tags (`via`).
  A v6.3 scoring redesign (event-vector fold, gain indexed on predicted
  retrievability, performance-gated not calendar-gated) is specified in the
  design chat and will arrive as a brief — do not improvise it.
- Sessions must stay time-efficient: target users are strong players who may
  already know lines. The app acknowledges demonstrated knowledge at the
  speed it is demonstrated; time is only for decay.
