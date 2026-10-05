# In C, permuted

Terry Riley's *In C*, as arranged in SuperCollider by Alan Tett (MUSC 4121, Spring 2019 & ATLS 5660, Fall 2026), running live in the browser. Every sound is synthesized by SuperCollider's own server, **scsynth**, compiled to WebAssembly ([SuperSonic](https://github.com/samaaron/supersonic)). Nothing is streamed and nothing has to run on another machine. Most of the implementation was written by Claude Code, vibe-coded by Alan Tett.

Open the page and press **Play**. The page has two forms of the piece, switched under the title:

- **Riley mode** (the default, from `Tett_A_In_C_2026.scd`): a group of players works through all 53 modules in order, following Riley's performing directions. Each player stays on a module for a random 45–90 seconds, waits if it gets 3 or more modules ahead of the slowest player, and waits on module 53 until everyone has arrived. An eighth-note pulse on high C plays until the last player finishes. The **Players** panel sets how many players there are, the shortest and longest stay, the lead limit, and each player's SynthDef. Dots on the module rows show where every player is.
- **Arranged (2019)** (from `Tett_A_In_C.scd`): the fixed `Ptpar` timeline of the original arrangement, with timeline lanes you can click to start from any point.

For each module you can set its octave, level and pan, mute or solo it, or re-roll it with the dice button. In the arranged form you can also choose which SynthDef plays it and how many times it repeats. In Riley mode, each player brings their own SynthDef and decides their own repeats.

**New permutation** re-rolls the whole piece. In Riley mode it also hands every player a new SynthDef from the `.scd`'s list. The seed also decides every player's choices, so a seed reproduces a whole performance. The knobs set how far a permutation may stray from the score:

- **Repeat spread** (arranged only): repeat counts beyond the original `[a, b].choose`.
- **Instrument swap** (arranged only): chance a module gets a different SynthDef.
- **Level variance:** how much module levels vary.
- **Entry drift** (arranged only): how early or late a module may come in.
- **Octave range:** how many octaves a module may be transposed. It follows Riley's directions: transposing up is favored, and only modules with long notes (a dotted quarter or longer) may go down. The **Oct** column lets you set any module's octave by hand.
- **Pan spread:** how far from center modules may be panned (the pulse stays centered). Each row also has its own pan knob. Panning happens in the mixer, so it works the same on every SynthDef.

**Record** saves what you hear (after the mixer, master level and limiter) as a 16-bit stereo WAV. It starts playback if needed. Press it again, or Stop, to finish, and the file downloads. A WAV takes about 11.5 MB per minute.

A seed reproduces a permutation exactly, and **Copy link** shares the exact version on screen.

## How it works

| File | What it does |
|---|---|
| `sc/Tett_A_In_C_2026.scd` | The 2026 version: all 53 modules, 12 SynthDefs and Riley mode. The page **reads the score straight from this file** when it loads: every `Pbind`, the module order, the player count, the `[\a, \b].choose` instrument list, the `rrand(45, 90)` stay, the `>= 3` lead limit, the pulse and the `TempoClock` tempo. |
| `sc/Tett_A_In_C.scd` | The 2019 arrangement, read the same way for the Arranged form: its `Pbind`s, `[a, b].choose` repeat counts, `Ppar` counts and `Ptpar` entry times. |
| `sc/build_synthdefs.scd` | Compiles the SynthDefs **from `Tett_A_In_C_2026.scd`** to `synthdefs/*.scsyndef`, plus `inc_mixer` (per-module faders, pans and meters). |
| `synthdefs/` | The compiled SynthDefs the browser loads into scsynth. |
| `js/scd.js` | The small `.scd` reader. It handles the subset the piece uses, not all of sclang. |
| `js/engine.js` | Boots SuperSonic and sends each note as a timestamped OSC bundle with the same arguments sclang's default event would send (e.g. `amp 0.1`, `freq` for `star`, `gate 0` after `dur × legato`). |
| `js/sequencer.js` | Arranged form: plays `Ptpar` + `Ppar` + `Pseq` on a `TempoClock`. |
| `js/riley.js` | Riley mode: the player logic from the 2026 file, scheduled in strict time order like SuperCollider's own scheduler, so a seed reproduces a performance. |
| `js/permute.js` | Seeded permutations and shareable links. |
| `js/viz.js` | The p5.js visualization. |
| `js/recorder.js` | The Record button: captures the master output to WAV. |

For the web version, every SynthDef writes to an `out` argument, not to bus 0, so each module can have its own fader, pan and meter. `pluck` and `highshort` were changed to `Out.ar(out, ...)` for this. In SuperCollider they sound the same, since `out` defaults to 0.

## Editing the piece

- **Changing the score:** edit `sc/Tett_A_In_C_2026.scd` (or `sc/Tett_A_In_C.scd` for the arranged form) and reload the page. The Riley mode numbers (players, `.choose` list, `rrand` stay, lead limit) are read from the file too.
- **Changing or adding a SynthDef:** edit it in `sc/Tett_A_In_C_2026.scd`, then open `sc/build_synthdefs.scd` in SuperCollider and run it. You don't need to boot the server. It reads every SynthDef from the 2026 file, warns about any that write to bus 0, and writes the `.scsyndef` files. Commit them. New SynthDef names show up in the dropdowns.

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
- *pluck* is after John Drumheller's Karplus-Strong example. *star* is from [sccode.org/1-522](https://sccode.org/1-522). *ff* is by Eli Fieldsteel ([sccode.org/1-5eb](https://sccode.org/1-5eb)). *click*, *highshort*, *envsine*, *highlong*, *midsine* and *burst* are by gosub ([sccode.org/1-5i2](https://sccode.org/1-5i2)).
- SuperSonic (scsynth + clockwork) is AGPL-3.0-or-later. It's loaded from the jsDelivr/unpkg CDN at a pinned version (0.88.0).
- [p5.js](https://p5js.org) is LGPL-2.1.
