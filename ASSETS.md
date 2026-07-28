# Assets and provenance

## The rule

Nothing ships without a complete row in `assets/manifest.json`. Missing field,
malformed date, or an expired `recheck` date fails `scripts/check-manifest.mjs`,
which runs in CI on every pull request. Any audio file committed anywhere in the
tree that no row claims also fails it.

This is enforced by a script rather than by review because a gate that depends on
whoever happened to look at the diff is not a gate. Anyone can read the CI log
and see whether it ran.

## What the gate does and does not do

**Does:** enforce that every shipped asset and every stated fact has a named
source, a licence, a date somebody verified it, and a date it gets re-checked.

**Does not:** decide whether a claim is true. The gate is *provenance*. Whether
barn owls actually do the thing we say they do is the Research Lead's craft. If
those two get blurred, the first time we ship something wrong each side will
assume the other one had it.

## Sampling, not re-verification

Per release, a handful of rows get chased at random back to their sources. One
failed sample stops the release and the whole batch gets re-verified. Re-checking
every row by hand would rebuild the bottleneck the Research Lead seat exists to
remove.

## Audio sources

| Source | Standing |
|---|---|
| Xeno-canto | CC-licensed, large for birds. Licence varies per file — check each. |
| Freesound | Usable CC0 subsets. Licence varies per file — check each. |
| Macaulay Library | Mostly restricted. Assume out unless proven otherwise. |

Per file, not per site. The animal list gets shaped by what is actually
licensed, not by what would be nice to have.

## Where audio lives

Licensed audio assets go in `assets/audio/`. That is the only directory in the
repository where audio is not ignored by git, so it is the only place a file can
enter — and the manifest checker looks at exactly that.

## Subject recordings

Recordings made by people testing the prototype are **not assets** and never
enter this repository. They are a person's voice. `.gitignore` blocks
`recordings/` and `sessions/`, and the app's export writes pitch contours and
metrics only — never audio. Consent and handling for the kill-line #1 subjects
sits with Adi and Ori, not with this repo.

Since 2026-07-28 that promise has a machine behind it: `scripts/check-no-upload.mjs`
fails CI if anything in the shipped source gains the ability to send data
anywhere — sendBeacon, XMLHttpRequest, WebSocket, a form, a non-GET fetch, or a
telemetry snippet. It was tested by making it fail. See `tester/` and the
consent screen it enforces.

## Current state, stated plainly

**2026-07-28.** The reference call is now a real recording: one call of a
black-throated loon (*Gavia arctica*), trimmed from
[XC803905](https://xeno-canto.org/803905), recorded in Sweden by Grégoire
Chauvot and released by them under **CC0 1.0**. The licence was read off that
recording's own page, per file — xeno-canto licences vary per recording and a
site-level claim would be worth nothing. Full row in `assets/manifest.json`,
including what was done to the audio (trim, mono, 22.05 kHz, peak normalise,
20 ms fades) and the sha1 of both the download and the shipped clip.

This unblocks kill-line #1, which could not run against the synthesized howl.

The synthesized howl still exists in `src/reference.js` as a **fallback only**.
If the real file fails to load, the interface says so instead of quietly
swapping an oscillator in — a person imitating a synthesizer is imitating a
synthesizer, and a number taken from that measures the wrong thing.

### Why a loon and not a wolf

Because a wolf with a verified licence was not found today and a loon with one
was. That is the rule working as intended: the animal list is shaped by what is
actually licensed. The loon call also happens to suit the instrument — it is
tonal, it rises about an octave and holds, and the tracker reads it at 87%
coverage with an 80 ms longest gap.

Checked and rejected today, with the reason, so nobody re-walks it:

| Candidate | Why not |
|---|---|
| Yellowstone NPS sound library (loon, elk, raven) | Tagged public domain on Wikimedia Commons, but credited at source to "NPS **& MSU Acoustic Atlas**/Jennifer Jerrett". A non-federal co-author is a real ambiguity and the NPS page states no licence of its own. Not clean enough to ship. |
| Xeno-canto API | v2 is switched off; v3 needs an API key tied to an account. Not blocking — the website is browsable and each recording page states its own licence. |
| Freesound | Needs an API token to search. Not attempted today; the CC0 subset stays a live option for animals xeno-canto does not cover. |
| Macaulay Library | Restricted, as recorded above. Not approached. |
