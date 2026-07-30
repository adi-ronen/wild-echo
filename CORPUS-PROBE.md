# Corpus probe — 2026-07-30

A kill-only instrument, run before any of the thirty recordings exist. It cannot
pass kill-line #1 and it did not try to. What it did was find a defect in how
condition A will read our own data, and that is why this file exists.

## What was run

`scripts/corpus-probe.mjs` over 57 crowd-sourced vocal imitations from the
**Vocal Imitation Set v1.1.3** (Bongjun Kim and Bryan Pardo, Northwestern
Interactive Audio Lab; CC BY 4.0, Zenodo record 10.5281/zenodo.1340763).

Three classes were taken, chosen because they are the pitched animal calls
closest to our three references — one of them is literally the same animal:

| Corpus class | Files | Why it was picked |
|---|---|---|
| `006 Animal / Dog / Howl` | 20 | Long sustained glide, the shape the loon reference makes |
| `022 Animal / Bird / Owl / Hoot` | 18 | Short flat notes, the shape the whooper swan makes |
| `023 Animal / Bird / Pigeon, dove / Coo` | 19 | Falling coo — the wood pigeon reference is this animal |

Every file in those three classes was measured. Nothing was discarded, and no
file was excluded after seeing its result.

The audio is **not** in this repo and nothing from it ships. It was fetched to a
scratch directory, measured, and the numbers are what survive. The tracker is
`src/pitch.js` unmodified — the same code that will judge the real takes.

## Result

```
Total: 18/57 clear condition A (32%)

coverage below 0.60:                   9
coverage fine, interior gap too long: 30   (median utterances in these: 4)
single-utterance clips:              5/5 clear condition A
median coverage across everything:    79%
```

Read the first line alone and the route looks dead: 32% against a bar of 80%.
That reading is wrong, and the next three lines are why.

## What it actually found

**Condition A's gap clause is counting repetitions, not tracking failures.**

Thirty of the thirty-nine failures had coverage comfortably above the 0.60 bar —
median coverage across all 57 files is 79% — and failed only on the longest
interior unvoiced gap. The median number of separate voiced bursts in those
thirty files is **four**. These are people who imitated the call, paused,
imitated it again, three or four times in one recording. The silence between
their attempts is a real unvoiced gap, and condition A reads it as the tracker
losing the note.

Of the clips that contain a single burst of voiced sound, **5 of 5 clear
condition A**. Five is a small number and this line is the weakest claim in the
file — but it points the same way as the median coverage.

The pigeon coo is the sharpest case: **0 of 19**, with coverage between 42% and
86% and gaps from 290 ms to 930 ms. A coo *is* a repeated short phrase. Nobody
imitates one with a continuous three-second note. Our third reference is that
animal.

## What this means for kill-line #1, stated carefully

The thresholds are frozen and nothing here touches them. 30 recordings, ≥24 on
condition A, ≥18 on condition B, verdict 2026-08-14, no renegotiation. This
probe is not data from our test and does not get to move a number in it.

What it does say is that **condition A can fail for a reason that has nothing to
do with whether the route works.** Our protocol says each person imitates each
call once. "Once" is a sentence on a screen, not something a microphone can
enforce. If our ten do what these people did — coo three times because a coo is
three coos — condition A fails at a rate near this one, and the verdict document
would record the route as dead when what actually died was the assumption that
an imitation is one continuous note.

**This is above the CTO's seat and is not being fixed here.** It goes to Ori for
Adi as a named risk to the instrument, with the numbers attached. The choice
between accepting that risk, changing the on-screen prompt before any data
exists, or letting the verdict fall and recording this as the reason, is not
Tal's to make. Any change to the prompt is also a change to what the consent
text describes, and the consent text is frozen with Adi.

## What this probe is not

- **Not our hardware, not our rooms, not our prompt.** Crowd-sourced, unknown
  microphones, and the corpus's task was "imitate this Freesound clip," not
  "imitate this animal call once."
- **Not a pass.** A good rate here would only have meant the arithmetic works on
  somebody else's input, which was never in doubt.
- **Not the pilot of three.** That instrument is still unrun and still the only
  cheap thing that uses our own tester.

## Tape in it

The resample to 16 kHz here is a box average plus linear interpolation, not the
browser's `OfflineAudioContext` filter. It is the wrong filter and it is named as
such in the script. The bias runs against us — extra high-frequency junk makes
YIN's periodicity estimate worse, never better — so a file that passes here
would also pass through a cleaner filter. Acceptable for a kill-only instrument;
it would not be acceptable for judging a real take, and it is not used for one.
