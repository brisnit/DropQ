# Known test flakes

Tests that fail intermittently **without** a code change causing it. Each entry
records what was measured, so the next person does not re-investigate from
scratch or — worse — "fix" a product that was never broken.

A flake earns a place here only once it has been measured on a clean tree. If it
only ever failed alongside your change, it is not a flake; it is your change.

---

## `guidance` browser spec — intermittent single-step failure

**Status:** open, unresolved. Not blocking.
**First recorded:** 2026-10-09.

### Symptom

`npm run test:browser` reports one failed assertion in the `guidance` spec. The
failing step is **different on each run**. Observed failures include:

- `publish: does not cover the control it explains`
- (earlier runs) other steps in the same spec, each appearing once

The suite passes in full on most runs.

### Measured rate

| Tree | Runs | Runs with a guidance failure |
| --- | --- | --- |
| Clean `main` (measured during the guidance-copy work) | 4 | 1 |
| That same work applied | 6 | 2 |
| DropMeet admin batch applied | 4 | 2 |
| Delete-guard change applied | 3 | 0 |

**5 of 17 runs, about 1 in 3.** Note the last row: three consecutive clean runs
is entirely consistent with a flake at this rate, and is not evidence it is
fixed. Nothing has been done to fix it.

The rate did not change when work landed in unrelated areas. The DropMeet admin
batch touches admin pages and the DropMeet query layer; the guidance spec
exercises vendor onboarding tooltips. They share no code.

### What is already ruled out

- **Not caused by the DropMeet or delete-guard changes.** The same rate was
  measured on a clean tree beforehand.
- **Not a single bad assertion.** A fixed broken step would fail every run; this
  moves around, which points at timing rather than logic.

### Likely cause, not yet confirmed

The failing assertions all check tooltip placement — that a coach mark does not
cover the control it describes. That is a measurement taken after layout and
animation settle, so it is the shape of thing that fails when a frame has not
been committed yet. The probable fix is for the spec to wait on the tooltip's
settled position rather than a timeout, but this has **not** been investigated
or verified.

### How to handle it meanwhile

- A lone `guidance` failure on an otherwise green suite is **not** a release
  blocker. Re-run; if the suite passes and the second run's failure (if any) is a
  *different* step, it is this flake.
- Two runs failing the **same** step is not this flake. Investigate it.
- Do not add a retry to the runner to paper over it. That would hide real
  regressions in the same spec.

### Next step when picked up

Reproduce by running `npm run test:browser:guidance` in a loop until it fails,
capture the screenshot and the two elements' bounding boxes at failure, and
decide whether the spec is racing layout or the tooltip genuinely overlaps at
some viewport. Fix the spec only if the overlap is not real.
