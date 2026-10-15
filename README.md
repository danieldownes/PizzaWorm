# Pizza Worm — in the browser

I'm a big fan of **Pizza Worm**, a 1995 DOS freeware game by Sami "Zorlim" Lehtinen
(graphics by AOK, music by Izzard). This repository is pure retro nostalgia: a faithful
re-implementation of version 2.1G that runs in a web browser, built by taking the
original `PWORM.EXE` apart and porting its logic routine by routine.

<p align="center">
  <a href="https://danieldownes.github.io/PizzaWorm/"><img alt="Play Pizza Worm in your browser" src="https://img.shields.io/badge/%E2%96%B6%20PLAY-Pizza%20Worm-d9472b?style=for-the-badge&labelColor=241b15"></a>
</p>

**Play it** in the browser with the button above, or download
[`index.html`](index.html) and open it locally. It is one
self-contained file and works offline.

| Player 1 (green) | Player 2 (red) | Anywhere |
|---|---|---|
| `←` `→` steer | `Z` `C` steer | `P` pause, `Esc` end round, `S` sound on/off |

On the score screen press `1` or `2` for a one- or two-player game. On a phone, hold the
left or right half of the screen to steer and tap to confirm.

The original game said *"THIS PROGRAM IS SO CALLED FREEWARE, SO SPREAD THIS!"* — the
untouched original release is kept in [`pworm21g.zip`](pworm21g.zip), with the author's
own `PWORM.DOC`. All credit for the game, its art and its music belongs to
its creators.

---

## Repository layout

```
pworm21g.zip            original 2.1G release archive (runs in DOSBox)
index.html              the playable browser version (generated, ~420 KB)
src/
  game.js               the game, ported from the EXE
  modplayer.js          small ProTracker replayer + sound-effect channel
  page.html             page shell, renderer, input and audio glue
  build.py              embeds the original data files (read from the zip) and writes index.html
```

Rebuild with `python src/build.py`.

## What was in the box

| File | What it turned out to be |
|---|---|
| `PWORM.EXE` | Turbo Pascal 7 program (MZ, not packed), with the MIDAS Sound System 0.4 linked in |
| `PWORM.001` | A 4-channel ProTracker `M.K.` module, *"Pizza Worm -Izzard-"*. Instruments 1–9 are the voice clips (`argh`, `laugh`, `c00l`, `sika`, `jam`, `good`, `namnam`, `I am hungry`…) |
| `PWORM.002` | 320×200×256 PCX: high-score screen |
| `PWORM.003` | 320×200×256 PCX: Zorlim's pizza parlor (the play field) |
| `PWORM.004` | 320×200×256 PCX: title picture |
| `PWORM.000` | High-score table (10 × name, score, checksum byte, plus a file checksum) |
| `PWORM.DOC` | The author's docs and version history |

The copy of `PWORM.000` here is all zeros, which the game treats as tampering
("LAMER! WARNING!"). The browser version keeps its own table in `localStorage`.

## How the decompilation was done

1. **Loading the image.** The MZ header gives a 6304-byte header and 1567 relocations.
   Reading the relocated words yields the list of segments: the main program at `0000`,
   a dozen units (graphics, file loading, keyboard, MIDAS wrappers, timer) and the
   Turbo Pascal `System` unit at `11A5`. The data segment is `1392`.
2. **Recursive-descent disassembly** with Capstone (16-bit x86), seeded from the entry
   point and every far-call relocation. Turbo Pascal puts string constants right in front
   of the procedure that uses them, so the undecoded gaps between procedures read as
   Pascal strings (`PAUSE`, `Player one won last round`, the parameter help…). This gave
   ~70 procedures in the main program.
3. **Identifying the runtime.** The 6-byte `Real` routines in `System` were matched by
   behaviour: `13C4` add, `13CA` subtract, `13D0` square, `13D6` multiply, `13DC` divide,
   `13EA` integer→real, `13EE` Trunc and `13F6` Round (the same helper with a rounding
   flag). `150F`/`14FC` are Sin/Cos, `149D` Sqrt, `1883` Random. Real48 constants were
   decoded by hand from the register loads, e.g. `80 2D 33 F3 04 35` = 0.7071 (1/√2),
   `86 E9 D2 E0 2E 65` = 57.2958 (degrees per radian).
4. **Naming the globals.** Variables were identified by how they are used, e.g.
   `[0B48]` the shared ring-buffer head, `[0B52+2p]` worm length, `[0B5A+6p]` and
   `[0B66+6p]` the Real X/Y positions, `[0B76+2p]` the heading in degrees, `[0B7C]`
   the keyboard state written by the INT 9 handler at `0000:0000`.
5. **Checking against the real thing.** The original was run in DOSBox under Xvfb,
   driven with `xdotool`, and screenshotted to compare screens, timing and colours. (A
   two-byte patch to a *scratch copy* of the EXE skipped the high-score checksum so the
   empty table would load.)

## How the game actually works

These details came out of the disassembly and are reproduced exactly.

- **Timing.** At start-up the game measures the VGA retrace with the PIT and installs a
  MIDAS timer callback synced to the screen, so everything runs at the 70 Hz refresh.
  Training mode (`/T`) simply waits two ticks per step.
- **Movement.** Headings are whole degrees in 5° steps. Sine and cosine are precomputed
  for 0–360° in 73 entries. Each tick: `X += sin(a)`, `Y += cos(a)` (one pixel), the
  arrow key adds or subtracts 5°, and the rounded position goes into a 15 000-entry ring
  buffer per worm.
- **The worm** is a 5-pixel plus sign. The head is drawn at the new position and the tail
  point `length` entries back is erased by copying pixels from a saved copy of the
  background picture.
- **Animated stripes for free.** Each new head pixel uses palette index `E6h + n`, with n
  cycling 0–25. Every tick the 26 palette entries are rewritten as a yellow→green
  gradient rotated by n, so the stripes travel down the body without redrawing anything.
  Player 2 uses `8Ch + n` with a green→red ramp. The "PIZZA WORM" lettering in the top
  bar happens to use those indices too, which is why it shimmers with the worm.
- **Collision is colour-based.** Three probes sit 2 px ahead of the head, at the heading
  and ±45°. Any palette index above `DCh` (the orange frame and worm 1) or in
  `8Ch–A5h` (worm 2) is fatal. `C8h–DCh` is pizza. Everything else in the parlor
  picture is safe, which is why worms glide straight over the "Zorlim's Pizza parlor"
  sign.
- **Pizzas** are drawn pixel by pixel: a random centre, radius 5–12, a rejection test
  over the disc against worm colours, an outer ring in `DCh`/`DBh` from rounded distances
  with 8-way symmetry, and a speckled filling in `C8h–D9h`. Those 19 palette entries get
  random red/orange values for every new pizza.
- **Scoring.** Eating a pizza of radius r adds `10·r` to the length, and the score is
  `length/10 − 3`, so a pizza is worth its radius. Crossing every 100 points plays the
  `sika` sample and jumps the music to a fanfare section. A score above 999 is treated as
  cheating.
- **Death** splashes "blood" for 20 passes: pixels in `AAh–B3h` around the head randomly
  spread into neighbours while those palette entries fade. The fade deliberately
  overflows the 6-bit VGA DAC, which gives the flicker.
- **Two players.** The worms start on the same column heading at each other. First to 10
  pizzas wins, a head-on collision (heads within 1.5 px) is a tie, and wins are kept for
  the session.
- **Sound.** MIDAS opens five channels: the module on channels 1–4 and sound effects on
  channel 0 at a fixed 11 000 Hz. The game jumps the song to set positions: `0` in
  play, `14` title and credits, `16` 100-point fanfare, `19` scores, `21` death. The
  pattern-jump effects in the module keep each section looping on its own.
- **Easter eggs.** Pause (`P`), press `C` three times, then `Esc`: big pizzas for the
  rest of the session. Names containing ZORLIM are rewritten to `$ ZORLIM $`, and the
  crew's names are shown in a different colour on the score table.

## How the browser version is built

- **Mode 13h emulation.** A 64 KB `VRAM` byte array (offsets wrap at 16 bits like the
  real segment) and a 6-bit, 256-entry DAC. Each animation frame the palette is
  expanded to RGBA and blitted to a 320×200 canvas, scaled to a 4:3 CRT shape. Because
  the game logic reads back screen pixels for collisions, the port keeps that model
  instead of using sprites.
- **Coroutines instead of a busy loop.** The original is written as nested blocking
  loops (`repeat … WaitTick … until`). Each routine became a JavaScript generator, where
  one `yield` is one 70 Hz tick and `yield*` calls a sub-routine. That lets even the death
  sequence, which calls the high-score screen from inside the collision check, be ported
  with the same structure. A `requestAnimationFrame` scheduler steps the coroutine at
  70.086 Hz.
- **Faithful arithmetic.** Turbo Pascal's `Random` LCG (`seed·08088405h + 1`),
  `Round` (half away from zero) and `Trunc` are reimplemented, along with integer
  division semantics. The game's own quirks and slight bugs are kept.
- **Input.** Browser key events are translated to PC scan codes and fed to a port of the
  game's INT 9 handler during play. Menus get a BIOS-style key buffer with ASCII and
  extended codes, and Finnish `ÄÖÅ` map to code page 437.
- **Audio.** `modplayer.js` is a compact ProTracker replayer (speed/tempo, arpeggio,
  slides, tone portamento, vibrato, tremolo, sample offset, jumps and breaks, `Exx`
  commands) with an extra effect channel, mixed through the Web Audio API. Its output was
  checked against libopenmpt's rendering of the same module.
- **Text mode bookends.** The DOS prompt, start-up banner and farewell messages are drawn
  on an 80×25 text grid, just as the game prints them.

Not ported: joystick support, the `/S` key-remapping dialog and the built-in doc viewer.
