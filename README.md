# Wild Echo

Hear an animal call. Make the call yourself. Watch both pitch lines on the same
axes, hear them played back one after the other, and go again.

Live at **https://zvuv.im/wild-echo/**

---

## What this is

A prototype, and it is honest about being one. It exists to answer one question
before anything gets built on top of it:

> When an untrained person imitates an animal call, on ordinary consumer
> hardware in an ordinary room, does their pitch produce a legible **shape**, or
> does it produce noise?

If it is noise, the whole route is wrong and we want to know this week.

## What it does not do

**It does not guess which animal you were imitating, and it never will.**

The original route was: person imitates an animal, the site recognises which
animal, scores the accuracy. That route was killed on physics, not on taste.
Human and animal vocal tracts differ in length, formant structure, F0 range and
noise profile — a human wolf howl and a human coyote howl sit *closer to each
other* than either sits to a real wolf. A nearest-neighbour lookup over that
would be matching mostly on "is this a human being loud."

A version of it was buildable (YAMNet embeddings, k-NN over recorded human
examples, roughly 60–75% top-1 with a cooperative adult and worse with a
six-year-old, who is the actual user). It was declined anyway. It is a judgment
machine: one confident wrong answer and a kid learns the site is broken, and
even when it is right it aims the person at the scorer instead of at the animal.

So the machine never guesses. There is no wrong answer to lose trust over, and
the only measurement on screen is one that can be said out loud in a sentence:
*we compared how your pitch moved to how the call's pitch moved.*

## What is measured, and what is not

Everything the interface reports is measured from the audio:

- **Coverage** — voiced frames divided by frames between your first and last
  voiced frame.
- **Longest interior gap** — the longest stretch inside that span where no pitch
  was found, in milliseconds.
- **Shape description** — duration, range in hertz and octaves, net direction,
  number of direction changes on a smoothed curve.

There is **no accuracy score**, designed or otherwise. If one is ever added it
will be labelled as designed, in the interface, where a user reads it.

## Running it

Static files, no build step, no dependencies. Any static server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

A microphone needs a secure context — `localhost` or HTTPS. Opening
`index.html` from the filesystem will not work, because ES modules and
`getUserMedia` both refuse `file://`.

## The reference call

One call of a **black-throated loon** (*Gavia arctica*), trimmed from
[XC803905](https://xeno-canto.org/803905) — recorded in Sweden by Grégoire
Chauvot and released under **CC0 1.0**, verified per file on the recording's own
page. `ASSETS.md` records what was checked, what was rejected, and why.

## The tester session page

`tester/` — served at `zvuv.im/wild-echo/tester/`. This is what a person gets at
the end of a link when they help run kill-line #1: consent, hear the call, one
take, and a small file of numbers they choose to send back.

Three things about it are worth reading before judging the design:

- **One take, nothing discarded.** No retry button. A take that goes badly is a
  result, and it is counted.
- **Nothing is uploaded, because there is nowhere to upload to.** GitHub Pages
  is static. The results come back as a file the tester saves and sends. That is
  a real weakness — it depends on a person — and it beats putting a stranger's
  voice on a third party's server.
- **The code in the link is a label, not a lock.** A static page can only check
  a password in code the visitor can read. So it does not pretend: the page says
  outright that anyone holding the link can open it, and the code exists so ten
  people's results can be told apart without using anybody's name.

Recording is switched **off** until `tester/config.json` has
`"consentApproved": true`. That flag is Adi's to flip, not Tal's — the consent
wording it gates is a promise made to another person.

## Checks

```sh
node scripts/test-pitch.mjs       # pitch tracker against signals of known f0
node scripts/check-manifest.mjs   # provenance gate  — every asset has a licence
node scripts/check-no-upload.mjs  # privacy gate     — nothing can send anything
```

All three run in CI on every pull request.

## Your voice stays here

There is no upload path in this codebase. Recording happens in the browser,
analysis happens in the browser, and the export button writes pitch contours and
metrics — never audio. `.gitignore` blocks recordings from entering the
repository at all. See `ASSETS.md`.

`scripts/check-no-upload.mjs` keeps that true by machine rather than by memory:
it fails the build on sendBeacon, XMLHttpRequest, WebSocket, a form, a non-GET
fetch, or a telemetry snippet anywhere in the shipped source. It was tested by
making it fail.

## Accessibility

Decided now, while it is still cheap:

- The whole thing works **without a microphone** — hear the call, see its trace.
- Every comparison is available as **playback** (call, you, call, you) and as
  **words**, not only as a line on a canvas. The visual is never the only
  channel.
- Pitch is drawn on a **log-frequency** axis, so 200→400 Hz looks like 400→800,
  which is how pitch is actually heard.
- A gap in a line is a real break, never an interpolated guess. The trace does
  not invent data to look smoother.

## What is tape, right now

- **One animal, not three.** The reference call is a real, CC0, licence-verified
  black-throated loon (XC803905). Kill-line #1 asks for three calls; two of them
  do not exist yet, and the animal list is shaped by what is licensed, not by
  what would be nice.
- **The tester page has never met a tester.** It has been driven end to end in a
  real browser with a fake microphone, which is not the same thing as ten adults
  on ten kitchen tables.
- **Results come back by hand.** A static page has no server to receive them, so
  the tester saves a file and sends it. That depends on a person doing a thing,
  which is the weakest link in the whole run and is stated rather than hidden.
- **Time alignment is naive** — both traces start at their first voiced frame.
  Good enough to see a shape, wrong for anything that depends on rhythm.
- **The tracker has only been tested against synthetic signals.** Breathy
  onsets, creak, room reverb, phone speaker bleeding into phone mic, and
  six-year-olds are all untested. Only real recordings answer those.

## Layout

```
index.html            the page
style.css
src/pitch.js          YIN f0 estimation + traceability metrics + shape description
src/audio.js          capture, decode, downsample, playback
src/draw.js           two contours on shared log-frequency axes
src/reference.js      the real reference call, and the synth fallback
src/main.js           wiring
assets/audio/         licensed audio — the only place audio may enter the repo
assets/manifest.json  provenance rows — the gate reads this
tester/               the one-take session page for kill-line #1 subjects
scripts/              the gates and the pitch tests
```

---

Zvuvim · [zvuv.im](https://zvuv.im/)
