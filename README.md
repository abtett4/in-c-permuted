# In C, permuted

Terry Riley's *In C*, as arranged in SuperCollider by Alan Tett (MUSC 4121, Spring 2019 & ATLS 5660, Fall 2026), running live in the browser. Every sound is synthesized by SuperCollider's own server, **scsynth**, compiled to WebAssembly ([SuperSonic](https://github.com/samaaron/supersonic)). Nothing is streamed and nothing has to run on another machine. Most of the implementation was written by Claude Code, vibe-coded by Alan Tett.

Open the page and press **Play**. For each module you can:

- choose which SynthDef plays it,
- set how many times it repeats,
- set its level, mute or solo it, or re-roll it with the dice button.

**New permutation** re-rolls the whole piece. The four knobs set how far a permutation may stray from the score:

- **Repeat spread:** repeat counts beyond the original `[a, b].choose`.
- **Instrument swap:** chance a module gets a different SynthDef.
- **Level variance:** how much module levels vary.
- **Entry drift:** how early or late a module may come in.
- **Octave range:** how many octaves a module may be transposed. It follows Riley's directions: transposing up is favored, and only modules with long notes (a dotted quarter or longer) may go down. The **Oct** column lets you set any module's octave by hand.

A seed reproduces a permutation exactly, and **Copy link** shares the exact version on screen.

## How it works

| File | What it does |
|---|---|
| `sc/Tett_A_In_C.scd` | The original piece. The page **reads the score straight from this file** when it loads: every `Pbind`, its `[a, b].choose` repeat counts, the `Ppar` counts, the `Ptpar` entry times and the `TempoClock` tempo. |
| `sc/build_synthdefs.scd` | Compiles the SynthDefs to `synthdefs/*.scsyndef`, plus `inc_mixer` (per-module faders and meters). |
| `synthdefs/` | The compiled SynthDefs the browser loads into scsynth. |
| `js/scd.js` | The small `.scd` reader. It handles the subset the piece uses, not all of sclang. |
| `js/engine.js` | Boots SuperSonic and sends each note as a timestamped OSC bundle with the same arguments sclang's default event would send (e.g. `amp 0.1`, `freq` for `star`, `gate 0` after `dur × legato`). |
| `js/sequencer.js` | Plays the form like `Ptpar` + `Ppar` + `Pseq` on a `TempoClock`. |
| `js/permute.js` | Seeded permutations and shareable links. |
| `js/viz.js` | The p5.js visualization. |

One change from the original SynthDefs: `pluck` gained an `out` argument (it wrote straight to bus 0), so it can go through the mixer like the others.

## Editing the piece

- **Changing the score:** edit `sc/Tett_A_In_C.scd` and reload the page. New modules (36–53) written in the same `songN = Pbind(...)` + `Ptpar` style appear automatically.
- **Changing or adding a SynthDef:** edit it in both `.scd` files, then open `sc/build_synthdefs.scd` in SuperCollider and run it. You don't need to boot the server. Commit the new `.scsyndef` files. New SynthDef names in the `.scd` show up in the dropdowns.

## Publishing on GitHub Pages

1. Create a new public repository on GitHub and upload everything in this folder (drag and drop works on the repo's web page).
2. In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick `main` and `/ (root)`.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## Running it locally

The page has to be served over HTTP (opening `index.html` directly won't work). From this folder:

```
npx serve
```

or use VS Code's Live Server.

## For a Zoom demo

The audio is generated on whichever computer has the page open. If that person shares their screen, they need to tick **Share sound** in Zoom's share dialog.

## Credits and licenses

- *In C* © Terry Riley, 1964.
- *pluck* is after John Drumheller's Karplus-Strong example. *star* is from [sccode.org/1-522](https://sccode.org/1-522).
- SuperSonic (scsynth + clockwork) is AGPL-3.0-or-later. It's loaded from the jsDelivr/unpkg CDN at a pinned version (0.88.0).
- [p5.js](https://p5js.org) is LGPL-2.1.
