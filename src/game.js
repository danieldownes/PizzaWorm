// ---------------------------------------------------------------------------
// Pizza Worm 2.1G (1995, Sami "Zorlim" Lehtinen) — browser reconstruction.
// Ported procedure by procedure from the Turbo Pascal 7 executable.
// Hex comments name the original code offsets (segment 0000).
// ---------------------------------------------------------------------------
'use strict';

// ---------- helpers ---------------------------------------------------------
function b64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const TRUNC = Math.trunc;
function ROUND(x) { return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5); }   // TP Round (half away from zero)
function IDIV(a, b) { return TRUNC(a / b); }

// Turbo Pascal 7 Random()
let randSeed = (Date.now() & 0x7fffffff) >>> 0;
function random(n) {
  randSeed = (Math.imul(randSeed, 0x08088405) + 1) >>> 0;
  return Math.floor(((randSeed >>> 16) * n) / 65536);
}

// ---------- VGA mode 13h emulation ----------------------------------------------
const VRAM = new Uint8Array(65536);          // A000:0000, 16-bit offsets wrap
const DAC = new Uint8Array(768);             // 6-bit palette
let videoMode = 'text';
function setRGB(i, r, g, b) { i &= 255; DAC[i * 3] = r & 63; DAC[i * 3 + 1] = g & 63; DAC[i * 3 + 2] = b & 63; }
function setPalette(p) { DAC.set(p.subarray(0, 768)); }
function getPalette() { return DAC.slice(); }
function addr(x, y) { return ((y * 320) + x) & 0xffff; }
function pget(x, y) { return VRAM[addr(x, y)]; }
function pset(x, y, c) { VRAM[addr(x, y)] = c; }
function bar(x1, y1, x2, y2, c) {           // 0729:0000
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) pset(x, y, c);
}
function line(x1, y1, x2, y2, c) {          // 0729:00e4
  let dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1, err = dx + dy;
  for (;;) { pset(x1, y1, c); if (x1 === x2 && y1 === y2) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x1 += sx; } if (e2 <= dx) { err += dx; y1 += sy; } }
}

// ---------- PCX loader -------------------------------------------------------------
function loadPCX(d) {
  const w = (d[8] | d[9] << 8) - (d[4] | d[5] << 8) + 1, h = (d[10] | d[11] << 8) - (d[6] | d[7] << 8) + 1;
  const bpl = d[66] | d[67] << 8;
  const raw = new Uint8Array(bpl * h); let o = 0, i = 128;
  while (o < raw.length && i < d.length - 769) { const b = d[i++]; if (b >= 0xc0) { const n = b & 63, v = d[i++]; for (let k = 0; k < n && o < raw.length; k++) raw[o++] = v; } else raw[o++] = b; }
  const img = new Uint8Array(65536);
  for (let y = 0; y < Math.min(h, 200); y++) for (let x = 0; x < Math.min(w, 320); x++) img[y * 320 + x] = raw[y * bpl + x];
  const pal = new Uint8Array(768); const po = d.length - 768;
  for (let k = 0; k < 768; k++) pal[k] = d[po + k] >> 2;
  return { img, pal };
}

// ---------- 5x5 font (DS:000C charset, DS:0021 glyphs) ---------------------------------
const FONT_CHARS = [0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x21,0x2e,0x2f,0x28,0x29,0x2c,0x41,0x8e,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x4a,0x4b,0x4c,0x4e,0x50,0x52,0x49,0x5a,0x4d,0x57,0x53,0x54,0x4f,0x99,0x55,0x56,0x58,0x59,0x51,0x3a,0x3f,0x2d,0x24,0x8f,0x3c,0x3e];
let FONT = null;  // filled from ASSETS.font (51*25 bytes)
function upcase(c) { return (c >= 97 && c <= 122) ? c - 32 : c; }
function drawText(x, y, color, s) {          // 06a8:0000
  for (let i = 1; i <= s.length; i++) {
    let ch = upcase(s.charCodeAt(i - 1) & 255);
    if (ch === 0x84) ch = 0x8e; if (ch === 0x94) ch = 0x99; if (ch === 0x86) ch = 0x8f;
    const gi = FONT_CHARS.indexOf(ch); if (gi < 0) continue;
    for (let col = 1; col <= 5; col++) for (let row = 1; row <= 5; row++) {
      if (FONT[gi * 25 + (row - 1) * 5 + (col - 1)]) pset(x + col - 6 + i * 5, y + row - 1, color + row - 1);
    }
  }
}
function align(s, w, mode) {                 // 06bf:020d  ('l','c','r')
  s = s.substring(0, w);
  if (mode === 'l') while (s.length < w) s = s + ' ';
  if (mode === 'c') while (s.length < w) { s = s + ' '; if (s.length < w) s = ' ' + s; }
  if (mode === 'r') while (s.length < w) s = ' ' + s;
  return s;
}
const ZORLIM = 'Zorlim';                      // 06bf:0000 decodes "Ymohdg" -> "Zorlim"

// ---------- text mode ------------------------------------------------------------------
const TEXT = { rows: [], curRow: 0, curCol: 0, color: 7, cursor: true };
function textClear() { TEXT.rows = []; for (let r = 0; r < 25; r++) TEXT.rows.push({ s: '', c: [] }); TEXT.curRow = 0; TEXT.curCol = 0; }
function textWrite(s) {
  for (const ch of s) {
    if (ch === '\n') { textNewline(); continue; }
    const r = TEXT.rows[TEXT.curRow];
    while (r.s.length < TEXT.curCol) { r.s += ' '; r.c.push(TEXT.color); }
    r.s = r.s.substring(0, TEXT.curCol) + ch + r.s.substring(TEXT.curCol + 1);
    r.c[TEXT.curCol] = TEXT.color; TEXT.curCol++;
    if (TEXT.curCol >= 80) textNewline();
  }
}
function textNewline() { TEXT.curCol = 0; TEXT.curRow++; if (TEXT.curRow >= 25) { TEXT.rows.shift(); TEXT.rows.push({ s: '', c: [] }); TEXT.curRow = 24; } }
function textWriteln(s = '') { textWrite(s); textNewline(); }
textClear();

// ---------- keyboard: BIOS buffer + INT 9 handler -------------------------------------------
const bios = [];
let kbdHooked = false;
function keyPressed() { return bios.length > 0; }
function readKey() { return bios.length ? bios.shift() : 0; }
function flushKeys() { bios.length = 0; }

// game state (names follow the original data segment)
const G = {
  k1: 0, k2: 0,               // [0B7C],[0B7D] key states
  keyR1: 0x4d, keyL1: 0x4b, keyR2: 0x2e, keyL2: 0x2c,   // [0C9E..0CA1]
  twoP: false,                // [0B46]
  slow: false,                // [0B92] training: half speed
  bigPizza: false,            // [0B93] training/cheat: radius 12
  c94: true,                  // keep playing
  c95: false,                 // round over
  len: [0, 30, 30],           // [0B52+2p]
  cnt: [0, 0, 0],             // [0C96+p] pizzas eaten
  X: [0, 0, 0], Y: [0, 0, 0], ang: [0, 0, 0],
  head: 0,                    // [0B48]
  ring: [null, new Int16Array(15001 * 2), new Int16Array(15001 * 2)],
  cyc: 0,                     // [0B5F]
  px: 0, py: 0, pr: 0,        // pizza [0B58],[0B5A],[0B5C]
  wins1: 0, wins2: 0,         // [0C9A],[0C9C]
  musicOn: true, sfxOn: true, // [0CAA],[0CAB]
};
function isr(scan) {                          // 0000:0000 keyboard interrupt
  if (scan === G.keyR1) G.k1 = 1;
  if (scan === G.keyL1) G.k1 = 2;
  if (scan === G.keyR1 + 0x80 && G.k1 === 1) G.k1 = 0;
  if (scan === G.keyL1 + 0x80 && G.k1 === 2) G.k1 = 0;
  if (scan === G.keyR2) G.k2 = 1;
  if (scan === G.keyL2) G.k2 = 2;
  if (scan === G.keyR2 + 0x80 && G.k2 === 1) G.k2 = 0;
  if (scan === G.keyL2 + 0x80 && G.k2 === 2) G.k2 = 0;
  if (scan === 1) G.k1 = 0xff;
  if (scan === 0xc5 || scan === 0x19) G.k1 = 0xfa;
  if (G.k1 === 0xfa && scan === 0x2e) G.k1 = 0xfb;
  if (scan < 0x81 && scan !== 0x19 && G.k1 === 0xfa) G.k1 = 0;
  if (scan === 0x1f) toggleSound();
}

// ---------- sound glue ---------------------------------------------------------------------
let mod = null;
function music(pos) { if (mod) mod.setPosition(pos); }        // 077e:021f
function sample(n) { if (mod) mod.playSample(n); }            // 077e:0000
function toggleSound() {                                        // 077e:0444
  G.musicOn = !G.musicOn; G.sfxOn = !G.sfxOn;
  if (mod) { mod.musicMuted = !G.musicOn; mod.sfxMuted = !G.sfxOn; }
  if (typeof onSoundChanged === 'function') onSoundChanged();
}

// ---------- assets ----------------------------------------------------------------------------
let TITLE, HISC, PLAY;
let SIN = new Float64Array(73), COS = new Float64Array(73);
function initTables() {                       // 3ACD
  for (let i = 0; i <= 72; i++) { SIN[i] = Math.sin(i * 5 / 57.29577951); COS[i] = Math.cos(i * 5 / 57.29577951); }
}
function wrapAng(a) { if (a > 360) a -= 360; if (a < 0) a += 360; return a; }
function tSin(a) { return SIN[IDIV(wrapAng(a), 5)]; }       // 3B81
function tCos(a) { return COS[IDIV(wrapAng(a), 5)]; }       // 3BD4

// ---------- coroutine helpers (one yield = one 70 Hz timer tick, proc 05D6) ----------------
function* wait(n) { for (let i = 0; i < n; i++) yield; }
function* waitAnyKey() { while (!keyPressed()) yield; return readKey(); }

// ---------- palette fades -------------------------------------------------------------------
function* fadeIn(r, g, b, steps, pal) {       // 5C81
  const cur = new Float64Array(768), st = new Float64Array(768);
  for (let i = 0; i < 256; i++) { cur[i * 3] = r; cur[i * 3 + 1] = g; cur[i * 3 + 2] = b; }
  for (let k = 0; k < 768; k++) st[k] = (pal[k] - cur[k]) / steps;
  for (let s = 1; s <= steps - 1; s++) {
    const tmp = new Uint8Array(768);
    for (let k = 0; k < 768; k++) { cur[k] += st[k]; tmp[k] = TRUNC(cur[k]); }
    yield; setPalette(tmp);
  }
  setPalette(pal);
}
function* fadeOut(r, g, b, steps) {          // 60A2
  const start = getPalette(), cur = new Float64Array(768), st = new Float64Array(768);
  const tgt = [r, g, b];
  for (let k = 0; k < 768; k++) { cur[k] = start[k]; st[k] = (tgt[k % 3] - cur[k]) / steps; }
  for (let s = 1; s <= steps - 1; s++) {
    const tmp = new Uint8Array(768);
    for (let k = 0; k < 768; k++) { cur[k] += st[k]; tmp[k] = TRUNC(cur[k]); }
    yield; setPalette(tmp);
  }
  for (let i = 0; i < 256; i++) setRGB(i, r, g, b);
}

// ---------- worm drawing ----------------------------------------------------------------------
function plus(x, y, c) {                      // 0643
  if (c !== 0) { pset(x - 1, y, c); pset(x, y - 1, c); pset(x, y, c); pset(x + 1, y, c); pset(x, y + 1, c); }
  else {
    const B = PLAY.img;
    for (const [dx, dy] of [[-1, 0], [0, -1], [0, 0], [1, 0], [0, 1]]) VRAM[addr(x + dx, y + dy)] = B[addr(x + dx, y + dy)];
  }
}
function ringGet(p, i) { const r = G.ring[p]; return [r[i * 2], r[i * 2 + 1]]; }
function ringSet(p, i, x, y) { const r = G.ring[p]; r[i * 2] = x; r[i * 2 + 1] = y; }

// ---------- HUD (1E84) ----------------------------------------------------------------------------
function* hud() {
  let s;
  if (!G.twoP) s = align(String(IDIV(G.len[1], 10) - 3), 3, 'r');
  else s = align(G.cnt[1] + ' ' + G.cnt[2], 3, 'r');
  bar(0x2b, 1, 0x38, 5, 0);
  if (G.twoP) {
    if (G.cnt[1] > 9) yield* death(2);
    if (G.cnt[2] > 9) yield* death(1);
  }
  drawText(0x2b, 1, 0xc2, s);
}

// ---------- pizza ----------------------------------------------------------------------------------
const R707 = 0.7071067811865476;
function sym8(cx, cy, x, y) { return [[cx + x, cy + y], [cx - x, cy + y], [cx + x, cy - y], [cx - x, cy - y], [cx + y, cy + x], [cx - y, cy + x], [cx + y, cy - x], [cx - y, cy - x]]; }
function* placePizza(p) {                     // 2355
  const a = TRUNC((IDIV(G.len[p] + G.pr * 10, 10) - 3) / 100);
  const b = TRUNC((IDIV(G.len[p], 10) - 3) / 100);
  if (a !== b) { music(0x10); sample(5); }
  G.cnt[p]++;
  G.len[p] += G.pr * 10;
  for (let i = 0xc8; i <= 0xda; i++) { const r = random(0x2b) + 0x14; const g = random(0x21); setRGB(i, r, g, 0); }
  let cx, cy, R;
  for (;;) {
    let bad = false;
    cx = random(280) + 10; cy = random(170) + 20; R = random(8) + 5;
    if (G.bigPizza) R = 12;
    G.px = cx; G.py = cy; G.pr = R;
    for (let y = R; y >= 0; y--) {
      const c = ROUND(R * R707) + 1;
      const xm = ROUND(Math.sqrt(R * R - y * y));
      if (xm >= c) for (let x = xm; x >= c; x--) {
        const pts = sym8(cx, cy, x, y);
        for (const [qx, qy] of pts) if (pget(qx, qy) > 0xdc) bad = true;
        if (G.twoP) for (const [qx, qy] of pts) { const v = pget(qx, qy); if (v > 0x8b && v < 0xa6) bad = true; }
      }
    }
    const s = ROUND(R * R707);
    for (let y = s; y >= -s; y--) for (let x = s; x >= -s; x--) {
      const v = pget(cx + x, cy + y);
      if (v > 0xdc) bad = true; else if (v < 0xa6 && v > 0x8b) bad = true;
    }
    if (!bad) break;
  }
  // draw it
  let fill = false;
  const c = ROUND(R * R707) - 1;
  for (let y = R; y >= c; y--) {
    const x0 = ROUND(Math.sqrt((R + 0.5) * (R + 0.5) - y * y));
    let x = x0;
    if (x0 >= 0) {
      for (x = x0; ; x--) {
        const d = ROUND(Math.sqrt(x * x + y * y) + 0.1);
        if (d === R - 1) for (const [qx, qy] of sym8(cx, cy, x, y)) pset(qx, qy, 0xdb);
        if (d === R) for (const [qx, qy] of sym8(cx, cy, x, y)) pset(qx, qy, 0xdc);
        if (d < R - 1) { fill = true; break; }
        if (x === 0) break;
      }
    }
    if (fill) {
      for (let xx = x & 255; xx >= 0; xx--) for (const [qx, qy] of sym8(cx, cy, xx, y)) pset(qx, qy, random(0x12) + 0xc8);
      fill = false;
    }
  }
  const s2 = ROUND(R * R707) - 2;
  for (let y = s2; y >= -s2; y--) for (let x = s2; x >= -s2; x--) pset(cx + x, cy + y, random(0x12) + 0xc8);
  yield* hud();
}
function* eatPizza(p) {                       // 2DE0
  if (IDIV(G.len[1], 10) - 3 > 999) { yield* fatal(['Something is now wrong.. Bye bye..']); return; }
  const s = random(3) + 1;
  sample(5 + s);
  const R = G.pr, cx = G.px, cy = G.py, B = PLAY.img;
  for (let y = R; y >= 0; y--) {
    const c = ROUND(R * R707) + 1;
    const xm = ROUND(Math.sqrt(R * R - y * y));
    if (xm >= c) for (let x = xm; x >= c; x--) for (const [qx, qy] of sym8(cx, cy, x, y)) VRAM[addr(qx, qy)] = B[addr(qx, qy)];
  }
  const sq = ROUND(R * R707);
  for (let y = sq; y >= -sq; y--) for (let x = sq; x >= -sq; x--) VRAM[addr(cx + x, cy + y)] = B[addr(cx + x, cy + y)];
  yield* placePizza(p);
}

// ---------- worm movement / collision ----------------------------------------------------------
function* pause() {                           // 3125
  const save = new Uint8Array(125);
  for (let x = 0; x <= 24; x++) for (let y = 0; y <= 4; y++) save[y * 25 + x] = pget(x + 0x94, y + 0x61);
  let cheat = 0;
  while (G.k1 === 0xfa || G.k1 === 0xfb) {
    yield* wait(5);
    drawText(0x94, 0x61, 0xc2, 'PAUSE');
    if (G.k1 === 0xfb) { cheat++; G.k1 = 0xfa; }
    yield* wait(5);
    for (let x = 0; x <= 24; x++) for (let y = 0; y <= 4; y++) pset(x + 0x94, y + 0x61, save[y * 25 + x]);
  }
  if (cheat === 3 && G.k1 === 0xff) { G.bigPizza = true; G.k1 = 0; G.k2 = 0; }
}
function* turn(p) {                           // 3242
  const k = p === 1 ? G.k1 : G.k2;
  if (k === 1) G.ang[p] -= 5;
  else if (k === 2) G.ang[p] += 5;
  else if (k === 0xfa) yield* pause();
  if (G.ang[p] > 360) G.ang[p] -= 360;
  if (G.ang[p] < 0) G.ang[p] += 360;
}
function* moveWorms() {                       // 4004
  G.head++; if (G.head > 15000) G.head = 1;
  const n = G.twoP ? 2 : 1;
  for (let p = 1; p <= n; p++) {
    G.X[p] += tSin(G.ang[p]);
    G.Y[p] += tCos(G.ang[p]);
    yield* turn(p);
    ringSet(p, G.head, ROUND(G.X[p]), ROUND(G.Y[p]));
  }
}
function* collide() {                         // 3C27
  const n = G.twoP ? 2 : 1, dead = [0, 0, 0];
  for (let p = 1; p <= n; p++) {
    dead[p] = 0;
    for (const off of [0, 45, -45]) {
      const qx = ROUND(G.X[p] + tSin(G.ang[p] + off) * 2), qy = ROUND(G.Y[p] + tCos(G.ang[p] + off) * 2);
      const v = pget(qx, qy);
      if (v > 0xdc || (v > 0x8b && v < 0xa6)) dead[p] = 1;
      if (!G.c95 && v > 0xc7 && v < 0xdd) yield* eatPizza(p);
    }
    if (G.k1 === 0xff && !G.c95) yield* death(0);
  }
  if (G.twoP) {
    if (Math.abs(G.X[1] - G.X[2]) < 1.5 && Math.abs(G.Y[1] - G.Y[2]) < 1.5) { dead[1] = 1; dead[2] = 1; }
    if (dead[1] && dead[2] && !G.c95) yield* death(0);
    if (dead[1] && !dead[2] && !G.c95) yield* death(1);
    if (!dead[1] && dead[2] && !G.c95) yield* death(2);
  } else if (dead[1]) yield* death(1);
}
function cyclePalette() {                     // 1F60
  for (let i = 0; i <= 25; i++) {
    const d = Math.abs(i - 13);
    if (i + 0xe6 + G.cyc > 0xff) {
      setRGB(i + G.cyc + 0xcc, 63 - 4 * d, 63 - d, 0);
      if (G.twoP) setRGB(i + G.cyc + 0x72, 2 * d + 31, 63 - 4 * d, 0);
    } else {
      setRGB(i + G.cyc + 0xe6, 63 - 4 * d, 63 - d, 0);
      if (G.twoP) setRGB(i + G.cyc + 0x8c, 2 * d + 31, 63 - 4 * d, 0);
    }
  }
}
function drawHeads() {                        // 20B6
  G.cyc++; if (G.cyc > 25) G.cyc = 0;
  let [x, y] = ringGet(1, G.head); plus(x, y, 0xe6 + G.cyc);
  if (G.twoP) { [x, y] = ringGet(2, G.head); plus(x, y, 0x8c + G.cyc); }
}
function eraseTails() {                       // 212A
  const n = G.twoP ? 2 : 1;
  for (let p = 1; p <= n; p++) {
    let i = G.head - G.len[p];
    if (i <= 0) i = G.head + 15000 - G.len[p];
    const [x, y] = ringGet(p, i);
    if (x !== 0) plus(x, y, 0);
    ringSet(p, i, 0, 0);
  }
}

// ---------- death (1B89) -----------------------------------------------------------------------------
function bloodPalette(f) { for (let i = 0xaa; i <= 0xb3; i++) setRGB(i, 63 - (0xaa - i) - 2 * f, 0, 0); }   // 0600
function spread(x, y, c) {                    // 0783
  c++; if (c === 0xb4) c = 0xaa;
  const t = pget(x, y);
  if (t <= 0xa9 && (t <= 0x8b || t >= 0xa6)) pset(x, y, c);
}
function* waitOrKey(n) {                      // 07EB
  let k = 0, i = 0;
  for (;;) {
    yield;
    if (keyPressed()) k = readKey();
    if (k === 27 || k === 32 || k === 13) break;
    i++; if (i > n) break;
  }
}
function* death(code) {
  music(0x15); sample(2);
  if (G.twoP) {
    bar(0x2b, 1, 0x38, 5, 0);
    if (code === 1) drawText(0x30, 1, 0xc2, '2');
    if (code === 2) drawText(0x30, 1, 0xc2, '1');
  }
  if (code !== 0) {
    let f = 0; bloodPalette(f);
    const r = G.ring[code], hi = G.head * 2;
    plus(r[hi], r[hi + 1], 0xaa);
    if (r[hi] < 0x14) r[hi] = 0x14;
    if (r[hi] > 0x12c) r[hi] = 0x12c;
    if (r[hi + 1] > 0xb4) r[hi + 1] = 0xb4;
    const hx = r[hi], hy = r[hi + 1];
    for (let pass = 1; pass <= 20; pass++) {
      for (let x = hx - 25; x <= hx + 25; x++) for (let y = hy - 25; y <= hy + 25; y++) {
        const v = pget(x, y), d = random(4);
        if (v > 0xa9 && v < 0xb4) {
          if (d === 3) spread(x - 2, y, v);
          else if (d === 2) spread(x + 1, y, v);
          else if (d === 1) spread(x, y - 2, v);
          else spread(x, y + 1, v);
        }
      }
      yield; f++; bloodPalette(f); yield;
    }
    unhookKeyboard();
    yield* waitOrKey(0x96);
  }
  if (code === 0) unhookKeyboard();
  G.c95 = true;
  if (!G.twoP) yield* hiscoreScreen();
  else yield* winsScreen(code);
}
function hookKeyboard() { kbdHooked = true; flushKeys(); }       // 0142
function unhookKeyboard() { kbdHooked = false; G.k1 = 0; G.k2 = 0; }  // 0162

// ---------- game -----------------------------------------------------------------------------------
function* newGame() {                         // 6671
  G.ring[1].fill(0); G.ring[2].fill(0);
  for (let i = 0; i <= 255; i++) setRGB(i, 0, 0, 0);
  for (let i = 0; i <= 255; i++) setRGB(i, 0, 0, 0);            // 32C2
  VRAM.set(PLAY.img.subarray(0, 64000));
  setPalette(PLAY.pal);
  setRGB(0xdb, 63, 63, 0); setRGB(0xdc, 30, 30, 0);              // 41CF
  setRGB(0xc2, 0x17, 63, 63); setRGB(0xc3, 0x21, 63, 63); setRGB(0xc4, 0x2b, 63, 63); setRGB(0xc5, 0x35, 63, 63); setRGB(0xc6, 63, 63, 63); // 41EE
  G.len[1] = 30; G.len[2] = 30; G.cnt[1] = 0; G.cnt[2] = 0; G.head = 0;
  G.X[1] = 160; G.Y[1] = 195; G.X[2] = 160; G.Y[2] = 10;
  G.cyc = 0; G.ang[1] = 180; G.ang[2] = 0; G.k1 = 0; G.k2 = 0; G.c95 = false; G.pr = 0;
  yield* placePizza(0);
  sample(9);
}
function* gameLoop() {                        // 4181
  hookKeyboard();
  music(0);
  while (!G.c95) {
    yield;
    cyclePalette();
    if (G.slow) yield;
    yield* moveWorms();
    yield* collide();
    if (!G.c95) { drawHeads(); eraseTails(); }
  }
}

// ---------- high scores ------------------------------------------------------------------------------
const HS_KEY = 'pizzaworm-2.1g-highscores';
function loadScores() {
  let t = null;
  try { t = JSON.parse(localStorage.getItem(HS_KEY)); } catch (e) { t = null; }
  const out = [];
  for (let i = 0; i < 12; i++) out.push({ n: '', s: 0 });
  if (Array.isArray(t)) for (let i = 0; i < 10 && i < t.length; i++) out[i + 1] = { n: String(t[i].n || '').substring(0, 20), s: (t[i].s | 0) };
  return out;
}
function saveScores(tab) {
  try { localStorage.setItem(HS_KEY, JSON.stringify(tab.slice(1, 11))); } catch (e) { /* storage unavailable */ }
}
function isCredit(n) {                        // 04F4
  const z = ZORLIM.toUpperCase();
  return n === z || n === '$ ' + z + ' $' || n === 'AOK' || n === 'TIMO KAUPPINEN' || n === 'IZZARD';
}
function hsPalette() {                        // 0B7A
  for (let i = 0xc8; i <= 0xcd; i++) setRGB(i, 63, 63, (0xcd - i) * 10);
  for (let i = 0xd2; i <= 0xd7; i++) setRGB(i, 63, (0xd7 - i) * 10, 63);
  for (let i = 0xdc; i <= 0xe0; i++) setRGB(i, (0xe0 - i) * 10, 0, 0);
  for (let i = 0xe6; i <= 0xeb; i++) setRGB(i, 63 - (i - 0xe6) * 10, 63, 63);
  for (let i = 0xf0; i <= 0xf5; i++) setRGB(i, 0, 0, 0xfa - i);
  setRGB(0, 0, 0, 0);
}
function hsBackground() {                     // 0C59
  for (let i = 0; i <= 255; i++) setRGB(i, 0, 0, 0);
  VRAM.set(HISC.img.subarray(0, 64000));
  setPalette(HISC.pal);
}
function frame4(x1, y1, x2, y2) {             // bevelled frame used by 0CCF / 18F9
  for (let k = 0; k < 4; k++) {
    const c = 0xdc + k;
    line(x1 - k, y1 - k, x2 + k, y1 - k, c);
    line(x1 - k, y1 - k, x1 - k, y2 + k, c);
    line(x2 + k, y1 - k, x2 + k, y2 + k, c);
    line(x1 - k, y2 + k, x2 + k, y2 + k, c);
  }
}
function* enterName(y) {                      // 086B
  const VALID = ' \x08\x0d0123456789!./(),A\x8eBCDEFGHJKLNPRIZMWSTO\x99UVXYQ:?-$\x8f<>';
  let name = '', done = false;
  while (!done) {
    let k = 0xff;
    if (keyPressed()) k = readKey();
    else {
      bar(name.length * 5 + 0x5f, y, (name.length + 1) * 5 + 0x5d, y + 4, 0xc8);
      yield* wait(5);
      bar(name.length * 5 + 0x5f, y, (name.length + 1) * 5 + 0x5d, y + 4, 0);
      yield* wait(5);
    }
    if (k === 0) { readKey(); k = 0xff; }
    k = upcase(k);
    if (k === 0x84) k = 0x8e; if (k === 0x94) k = 0x99; if (k === 0x86) k = 0x8f;
    if (k < 8) k = 0;
    if (VALID.indexOf(String.fromCharCode(k)) < 0) k = 0;
    if (k !== 0 && k !== 13 && name.length < 20) {
      name += String.fromCharCode(k);
      bar(0x5f, y, 0xc8, y + 4, 0); drawText(0x5f, y, 0xc8, name);
    }
    if (k === 8 && name.length > 0) {
      name = name.substring(0, Math.max(0, name.length - 2));
      bar(0x5f, y, 0xc8, y + 4, 0); drawText(0x5f, y, 0xc8, name);
    }
    if (k === 13) done = true;
  }
  const z = ZORLIM.toUpperCase();
  if (name.indexOf(z) >= 0 && name.length !== 6) name = '$ ' + z + ' $';
  return name;
}
function* prompts() {                         // 0E8D -> returns the key that ended it
  flushKeys();
  let key = 0, b = 1, up = false, state = 4;
  for (;;) {
    if (key === 13 || key === 32 || key === 27 || key === 0x31 || key === 0x32) break;
    if (keyPressed()) key = readKey();
    if (G.twoP && upcase(key) === 0x52) {
      G.wins1 = 0; G.wins2 = 0;
      bar(0, 0xc2, 0x13f, 0xc7, 0);
      drawText(0x82, 0xc2, 0xf0, 'WINS CLEARED');
      bar(0x87, 0x5d, 0xb9, 0x62, 0);
      drawText(0x87, 0x5d, 0xd2, align('1:0 2:0', 10, 'c'));
      b = 0x39; up = true; key = 0;
    }
    if (b === 0) {
      if (state === 1) { bar(0, 0xc2, 0x13f, 0xc7, 0); drawText(0x41, 0xc2, 0xf0, 'PRESS ENTER FOR NEWGAME OR ESC TO EXIT'); }
      if (state === 2) { bar(0, 0xc2, 0x13f, 0xc7, 0); drawText(0x1e, 0xc2, 0xf0, 'PRESS 1 FOR ONE PLAYER GAME OR 2 FOR TWO PLAYER GAME'); }
      if (state === 3) { bar(0, 0xc2, 0x13f, 0xc7, 0); drawText(0x5a, 0xc2, 0xf0, '$ PIZZA WORM BY ' + ZORLIM.toUpperCase() + ' $'); }
      if (state === 4) {
        if (G.twoP) { bar(0, 0xc2, 0x13f, 0xc7, 0); drawText(0x70, 0xc2, 0xf0, 'PRESS R TO RESET WINS'); }
        else { b = 1; up = false; }
      }
    }
    if (up) b++; else b--;
    if (b === 0x3a) up = false;
    if (b === 0) { up = true; state++; if (state === 5) state = 1; }
    for (let i = 0xf0; i <= 0xf5; i++) { const v = i - 0xf0 + b; setRGB(i, v, v, v); }
    yield* wait(2);
  }
  return key;
}
function* hiscoreScreen() {                   // 185F
  const score = IDIV(G.len[1], 10) - 3;
  music(0x13);
  hsBackground(); hsPalette();                // 0CCF
  bar(0x51, 0x40, 0xe5, 0x7d, 0);
  frame4(0x50, 0x40, 0xe6, 0x7e);
  const tab = loadScores();                   // 11F1
  if (score > 999) { yield* fatal(['You are too good for this game. ;)', 'DAMN YOU CHEATER!']); return; }
  let rank = 11;                              // 1410
  for (rank = 1; rank <= 11; rank++) if (tab[rank].s < score) break;
  if (rank > 11) rank = 11;
  if (G.slow) rank = 11;
  if (rank < 11) {
    for (let i = 10; i >= rank; i--) tab[i + 1] = { n: tab[i].n, s: tab[i].s };
    tab[rank] = { n: '                    ', s: score };
  }
  for (let i = 1; i <= 10; i++) {             // 1581
    let col = 0xd2;
    if (isCredit(tab[i].n)) col = 0xe6;
    if (rank === i) col = 0xc8;
    const y = (i - 1) * 6 + 0x42;
    drawText(0x5f, y, col, tab[i].n);
    drawText(0x50, y, col, align(String(i), 2, 'r'));
    drawText(0xd2, y, col, align(String(tab[i].s), 4, 'r'));
  }
  if (score < 50) sample(3);
  if (rank < 4) sample(4);
  if (rank < 11) {                            // 16B7
    const nm = yield* enterName((rank - 1) * 6 + 0x42);
    tab[rank].n = nm.substring(0, 20);
    saveScores(tab);
  }
  const key = yield* prompts();
  if (key === 0x31) G.twoP = false;
  if (key === 0x32) G.twoP = true;
  setRGB(0, 0, 0, 0);
  if (key === 27) G.c94 = false;
}
function* winsScreen(code) {                  // 1A69
  hsBackground(); hsPalette();
  music(0x13);
  bar(0x5a, 0x4e, 0xe6, 0x63, 0);             // 18F9
  frame4(0x5a, 0x4e, 0xe6, 0x63);
  if (code === 1) { drawText(0x62, 0x50, 0xd2, 'Player two won last round'); G.wins2++; }
  else if (code === 2) { drawText(0x62, 0x50, 0xd2, 'Player one won last round'); G.wins1++; }
  if (code === 0) drawText(0x6e, 0x50, 0xd2, 'Last round was a tie');
  drawText(0x87, 0x57, 0xd2, 'Total Wins');
  drawText(0x87, 0x5d, 0xd2, align('1:' + G.wins1 + ' 2:' + G.wins2, 10, 'c'));
  const key = yield* prompts();
  if (key === 0x31) G.twoP = false;
  if (key === 0x32) G.twoP = true;
  setRGB(0, 0, 0, 0);
  if (key === 27) G.c94 = false;
}

// ---------- credits (363E / 3338) ------------------------------------------------------------------
function* credits() {
  for (let i = 0; i <= 255; i++) setRGB(i, 0, 0, 0);
  VRAM.fill(0);
  for (let y = 0; y <= 0xc7; y++) { line(0, y, 0x13f, y, y + 1); setRGB(y + 1, 0, 0, 0); }
  const st = { a: 2 * Math.PI, c: 500, dir: true, prev: [0, 0, 0, 0] };
  drawText(0x5e, 0x55, 0xd2, 'This game is made by ' + ZORLIM);
  drawText(0x4d, 0x5c, 0xc9, '$ Graphics: AOK $ MUSIC: IZZARD $');
  for (let i = 0; i <= 5; i++) setRGB(0xc9 + i, 63, 63, 63 - i * 10);
  for (let i = 0; i <= 5; i++) setRGB(0xd2 + i, i * 10, 63 - i * 10, 63);
  for (let i = 0; i <= 3; i++) setRGB(0xdc + i, 0, 0, i * 15);
  music(0x0e); sample(4);
  flushKeys();
  let key = 0;
  while (key !== 27 && key !== 32 && key !== 13) {
    yield;
    st.a -= 2 * Math.PI / st.c;
    if (st.c < 20) st.dir = false;
    if (st.c > 600) st.dir = true;
    if (st.dir) st.c--; else st.c++;
    if (st.a < 0) st.a = 2 * Math.PI;
    const bars = [[0.8, (v) => [0, 0, v]], [0.4, (v) => [0, v, 0]], [0, (v) => [v, 0, 0]]];
    bars.forEach(([ph, colf], k) => {
      const pos = ROUND(Math.sin(st.a + ph) * 93);
      for (let j = -5; j <= 5; j++) setRGB(st.prev[k] + 100 + j, 0, 0, 0);
      st.prev[k] = pos;
      for (let j = -5; j <= 5; j++) { const c = colf(63 - Math.abs(j * 12)); setRGB(pos + 100 + j, c[0], c[1], c[2]); }
    });
    if (keyPressed()) key = readKey();
  }
}

// ---------- text-mode bits ---------------------------------------------------------------------------
function center(s) { const w = 79; const pad = Math.max(0, Math.floor((w - s.length) / 2)); return ' '.repeat(pad) + s; }
const RESTART = { restart: true };
function* fatal(lines) {
  unhookKeyboard();
  videoMode = 'text'; textClear(); TEXT.color = 10;
  for (const l of lines) textWriteln(l);
  textWriteln(); TEXT.color = 7; textWrite('C:\\>');
  throw RESTART;
}
function* farewell() {                        // 393C
  videoMode = 'text'; textClear(); TEXT.color = 10;
  textWriteln();
  textWriteln(center('You played Pizza Worm by ' + ZORLIM + ' (Sami Lehtinen, Helsinki, Finland)'));
  textWriteln();
  textWriteln(center('Write PWorm /? for parameter info.'));
  textWriteln();
  textWriteln(center('Write PWorm /d to view docs, history, hints.'));
  textWriteln();
  textWriteln(center('If you have any comments about my game just drop e-mail to:'));
  textWriteln(center(ZORLIM + '@freenet.hut.fi (forwards mail to my favorite site)'));
  textWriteln();
  textWriteln(center('Little hint to pizza chains. How about making your special ad version?'));
  textWriteln(); textWriteln();
  TEXT.color = 7;
  textWrite('C:\\>');
}

// ---------- main program -------------------------------------------------------------------------------
function* dosPrompt() {
  TEXT.color = 7;
  const cmd = 'PWORM';
  for (const ch of cmd) { textWrite(ch); yield* wait(5); }
  yield* wait(6);
  textNewline();
}
function* program(first) {
  if (first) {
    videoMode = 'text'; textClear(); TEXT.color = 7;
    textWriteln('Microsoft(R) MS-DOS(R) Version 6.22'); textWriteln();
    textWrite('C:\\>');
  }
  yield* dosPrompt();
  TEXT.color = 10;                             // 6813
  textWriteln('Pizza Worm 2.1G (C) ' + ZORLIM + ' 1995 (Gus Beta)');
  yield* wait(70);                             // Delay(1000)
  // 6528: init graphics + title
  videoMode = 'vga'; VRAM.fill(0);
  for (let i = 0; i <= 255; i++) setRGB(i, 0, 0, 0);
  G.twoP = false; G.wins1 = 0; G.wins2 = 0; G.c94 = true; G.fatal = false;
  G.slow = !!OPTIONS.training; G.bigPizza = !!OPTIONS.training;
  const tpal = TITLE.pal.slice();
  VRAM.set(TITLE.img.subarray(0, 64000));
  for (let i = 0xfa; i <= 0xfe; i++) { tpal[i * 3] = 63; tpal[i * 3 + 1] = 63; tpal[i * 3 + 2] = 63; }
  drawText(300, 0, 0xfb, '2.1G');
  music(0x0e);
  sample(1);
  yield* fadeIn(0, 0, 0, 0x7e, tpal);
  const save = new Uint8Array(35 * 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 35; x++) save[y * 35 + x] = pget(x, y);
  drawText(0, 0, 0xfb, 'LoAdInG');
  yield* wait(20);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 35; x++) pset(x, y, save[y * 35 + x]);
  flushKeys();
  yield* waitAnyKey();
  yield* fadeOut(0, 0, 0, 0x7e);
  // main loop
  G.c94 = true; G.len[1] = 30;
  yield* hiscoreScreen();
  while (G.c94) {
    yield* newGame();
    yield* gameLoop();
  }
  yield* credits();
  yield* farewell();
}
function* session() {
  let first = true;
  for (;;) {
    try { yield* program(first); } catch (e) { if (e !== RESTART) throw e; }
    first = false;
    if (mod) mod.playing = false;
    flushKeys();
    yield* waitAnyKey();
  }
}
const OPTIONS = { training: false };
