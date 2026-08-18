# lines — Bootstrap Kit

Two parts. **Part 1** is the brief you paste into the first Claude Code session.
**Part 2** is the full text of `CLAUDE.md` — the session copies it into the repo verbatim.

Before the session, the repo should contain (drag-and-drop via GitHub web upload):
- `lines-v6.jsx` (the app source, from the design chat)
- `lines-pwa.zip` (the built PWA bundle — the session mines manifest/sw/icons from it)

---

## PART 1 — Paste this as the first message of the bootstrap Code session

Convert this single-file React app into a properly structured Vite PWA repo with CI.
Behavior must remain pixel-identical. Work on a branch, open a PR when done.

### 1. Restructure
- `lines-v6.jsx` → `src/app.jsx` with minimal edits only: add React imports
  (it was written for a global-React environment), `export default` the root
  component. Do NOT refactor logic, rename identifiers, or "clean up" — this file
  has machine-verified chess content and battle-tested persistence code.
- Create `src/main.jsx`: import App, mount to `#root`, register `/sw.js`.
- Unzip `lines-pwa.zip`; copy `manifest.json`, `sw.js`, and the icon PNGs into
  `public/`. Recreate `index.html` for Vite, copying the PWA meta/link tags
  (manifest, theme-color, apple-touch-icon, viewport) from the zip's index.html.
- Delete the zip and the original jsx from the repo root once ported.

### 2. Build
- Vite + `@vitejs/plugin-react`. `npm run dev`, `npm run build` → `dist/`.
- The app's storage layer (`STORE` shim) already handles the non-artifact
  environment via localStorage — do not modify it.
- Set the `APP_VER` constant to `v6.2·git` (footer stamp = deploy verification).

### 3. Verification suite → `tools/`, wired to `npm test`
Write these as standalone Node scripts (no framework needed, assert + exit code):
- `tools/perft.mjs` — import the movegen from src (export it if needed; export-only
  edits are allowed) and assert standard perft counts:
  - startpos: d3=8,902 · d4=197,281 · d5=4,865,609
  - kiwipete `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -`:
    d3=97,862 · d4=4,085,603
  - ep position `8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -`: d4=43,238 · d5=674,624
  - promotion `rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -`: d3=62,379
- `tools/see-audit.mjs` — walk every position in the PACKS/tree data, run the
  static-exchange check over every scripted White move, assert zero material-losing
  moves (the tree is currently SEE-clean; any regression fails CI).
- `tools/roundtrip.mjs` — build a synthetic training state, run the export
  serializer → restore parser, assert exact state equality (all positions,
  days, via-doors, run records).
- `npm test` runs all three; all must exit 0.

### 4. CI/CD
- `.github/workflows/ci.yml`: on every PR and push to main — `npm ci`,
  `npm test`, `npm run build`. Red X blocks merging.
- Deployment is Cloudflare Pages (Git-connected, build `npm run build`,
  output `dist`) — no deploy config needed in the repo.

### 5. Constitution
- Create `CLAUDE.md` at repo root with EXACTLY the text of Part 2 of the
  BOOTSTRAP.md file in this repo.

### Definition of done
`npm run build` succeeds · `npm test` fully green · CLAUDE.md present ·
PR open with a summary listing what was verified and every file touched.

---

## PART 2 — CLAUDE.md (copy verbatim into repo root)

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
