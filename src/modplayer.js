// ---------------------------------------------------------------------------
// Minimal ProTracker (M.K.) replayer + one sound-effect channel.
// Mirrors how Pizza Worm used MIDAS: module on channels 1-4, effects on
// channel 0 played at a fixed 11000 Hz rate.
// ---------------------------------------------------------------------------
class ModPlayer {
  constructor(bytes) {
    const d = bytes;
    this.title = '';
    this.samples = [null];
    let off = 20;
    for (let i = 0; i < 31; i++, off += 30) {
      const len = ((d[off + 22] << 8) | d[off + 23]) * 2;
      let ft = d[off + 24] & 15; if (ft > 7) ft -= 16;
      const vol = Math.min(64, d[off + 25]);
      const ls = ((d[off + 26] << 8) | d[off + 27]) * 2;
      const ll = ((d[off + 28] << 8) | d[off + 29]) * 2;
      this.samples.push({ len, ft, vol, ls, ll, data: null });
    }
    this.songLen = d[950];
    this.order = Array.from(d.subarray(952, 952 + 128));
    let npat = 0;
    for (let i = 0; i < 128; i++) npat = Math.max(npat, this.order[i] + 1);
    this.patterns = d.subarray(1084, 1084 + npat * 1024);
    let p = 1084 + npat * 1024;
    for (let i = 1; i <= 31; i++) {
      const s = this.samples[i];
      const f = new Float32Array(s.len + 1);
      for (let k = 0; k < s.len && p + k < d.length; k++) {
        const v = d[p + k];
        f[k] = (v > 127 ? v - 256 : v) / 128;
      }
      p += s.len;
      s.data = f;
      if (s.ll > 2 && s.ls + s.ll > s.len) s.ll = Math.max(0, s.len - s.ls);
    }
    this.rate = 44100;
    this.musicMuted = false;
    this.sfxMuted = false;
    this.reset();
  }
  reset() {
    this.ch = [];
    for (let i = 0; i < 4; i++) this.ch.push(this.newChan(i));
    this.sfx = { s: null, pos: 0, step: 0, vol: 64 };
    this.speed = 6; this.tempo = 125; this.tick = 0;
    this.pos = 0; this.row = 0; this.playing = false;
    this.tickLeft = 0;
    this.breakRow = -1; this.jumpPos = -1; this.patDelay = 0; this.loopJump = false;
  }
  newChan(i) {
    return { pan: (i === 0 || i === 3) ? -0.6 : 0.6, s: null, inst: 0, pos: 0, period: 0, basePeriod: 0,
      vol: 0, outVol: 0, outPeriod: 0, fx: 0, prm: 0, portaTarget: 0, portaSpeed: 0, vibPos: 0, vibSpeed: 0,
      vibDepth: 0, tremPos: 0, tremSpeed: 0, tremDepth: 0, offset: 0, loopRow: 0, loopCount: 0,
      note: null, active: false, delayNote: null };
  }
  setPosition(p) {
    this.pos = p % this.songLen; this.row = 0; this.tick = 0;
    this.breakRow = -1; this.jumpPos = -1; this.patDelay = 0;
    this.playing = true; this.tickLeft = 0;
  }
  playSample(n) {
    const s = this.samples[n];
    if (!s || !s.len) return;
    this.sfx = { s, pos: 0, step: 11000 / this.rate, vol: s.vol };
  }
  periodFreq(per) { return per > 0 ? 3546894.6 / per : 0; }
  static get PT() {
    return [856,808,762,720,678,640,604,570,538,508,480,453,428,404,381,360,339,320,302,285,269,254,240,226,
      214,202,190,180,170,160,151,143,135,127,120,113];
  }
  noteIndex(per) {
    const t = ModPlayer.PT; let best = 0, bd = 1e9;
    for (let i = 0; i < t.length; i++) { const dd = Math.abs(t[i] - per); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  trigger(c, n) {
    if (n.inst) { c.inst = n.inst; c.s = this.samples[n.inst]; c.vol = c.s.vol; }
    if (n.period) {
      let per = n.period;
      if (c.s && c.s.ft) per = per * Math.pow(2, -c.s.ft / 96);
      if (n.fx === 3 || n.fx === 5) { c.portaTarget = per; }
      else {
        c.period = per; c.basePeriod = per; c.pos = 0; c.active = !!(c.s && c.s.len);
        if (!(c.vibWave & 4)) c.vibPos = 0;
        if (n.fx === 9) { if (n.prm) c.offset = n.prm * 256; c.pos = c.offset; if (c.s && c.pos >= c.s.len) c.active = false; }
      }
    }
  }
  processRow() {
    const pat = this.order[this.pos];
    const base = pat * 1024 + this.row * 16;
    const P = this.patterns;
    for (let i = 0; i < 4; i++) {
      const c = this.ch[i];
      const b0 = P[base + i * 4], b1 = P[base + i * 4 + 1], b2 = P[base + i * 4 + 2], b3 = P[base + i * 4 + 3];
      const n = { inst: (b0 & 0xf0) | (b2 >> 4), period: ((b0 & 15) << 8) | b1, fx: b2 & 15, prm: b3 };
      c.fx = n.fx; c.prm = n.prm;
      const ex = n.prm >> 4, ey = n.prm & 15;
      if (n.fx === 14 && ex === 13 && ey) { c.delayNote = n; }
      else this.trigger(c, n);
      switch (n.fx) {
        case 3: if (n.prm) c.portaSpeed = n.prm; break;
        case 4: if (ex) c.vibSpeed = ex; if (ey) c.vibDepth = ey; break;
        case 7: if (ex) c.tremSpeed = ex; if (ey) c.tremDepth = ey; break;
        case 11: this.jumpPos = n.prm; this.breakRow = Math.max(this.breakRow, 0); break;
        case 12: c.vol = Math.min(64, n.prm); break;
        case 13: this.breakRow = ex * 10 + ey; if (this.jumpPos < 0) this.jumpPos = this.pos + 1; break;
        case 14:
          if (ex === 1) c.period = Math.max(113, c.period - ey);
          else if (ex === 2) c.period = Math.min(856, c.period + ey);
          else if (ex === 6) {
            if (ey === 0) c.loopRow = this.row;
            else { if (c.loopCount === 0) c.loopCount = ey; else c.loopCount--; if (c.loopCount) { this.loopJump = c.loopRow; } }
          }
          else if (ex === 10) c.vol = Math.min(64, c.vol + ey);
          else if (ex === 11) c.vol = Math.max(0, c.vol - ey);
          else if (ex === 12 && ey === 0) c.vol = 0;
          else if (ex === 14) this.patDelay = ey;
          break;
        case 15: if (n.prm) { if (n.prm < 32) this.speed = n.prm; else this.tempo = n.prm; } break;
      }
      c.outPeriod = c.period; c.outVol = c.vol;
    }
  }
  effectsTick() {
    for (const c of this.ch) {
      const x = c.prm >> 4, y = c.prm & 15;
      c.outPeriod = c.period; c.outVol = c.vol;
      switch (c.fx) {
        case 0: if (c.prm) { const m = this.tick % 3; if (m) { const k = m === 1 ? x : y; c.outPeriod = c.period * Math.pow(2, -k / 12); } } break;
        case 1: c.period = Math.max(113, c.period - c.prm); c.outPeriod = c.period; break;
        case 2: c.period = Math.min(856, c.period + c.prm); c.outPeriod = c.period; break;
        case 3: case 5:
          if (c.portaTarget) {
            if (c.period < c.portaTarget) c.period = Math.min(c.portaTarget, c.period + c.portaSpeed);
            else if (c.period > c.portaTarget) c.period = Math.max(c.portaTarget, c.period - c.portaSpeed);
            c.outPeriod = c.period;
          }
          if (c.fx === 5) this.volSlide(c, x, y);
          break;
        case 4: case 6:
          c.outPeriod = c.period + (Math.sin(c.vibPos * Math.PI / 32) * c.vibDepth * 255 / 128);
          c.vibPos = (c.vibPos + c.vibSpeed) & 63;
          if (c.fx === 6) this.volSlide(c, x, y);
          break;
        case 7:
          c.outVol = Math.max(0, Math.min(64, c.vol + Math.sin(c.tremPos * Math.PI / 32) * c.tremDepth * 255 / 64 / 4));
          c.tremPos = (c.tremPos + c.tremSpeed) & 63; break;
        case 10: this.volSlide(c, x, y); break;
        case 14:
          if (x === 9 && y && this.tick % y === 0) c.pos = 0;
          if (x === 12 && this.tick === y) { c.vol = 0; c.outVol = 0; }
          if (x === 13 && this.tick === y && c.delayNote) { this.trigger(c, c.delayNote); c.delayNote = null; c.outPeriod = c.period; c.outVol = c.vol; }
          break;
      }
    }
  }
  volSlide(c, x, y) { if (x) c.vol = Math.min(64, c.vol + x); else c.vol = Math.max(0, c.vol - y); c.outVol = c.vol; }
  doTick() {
    if (!this.playing) return;
    if (this.tick === 0) { if (this.patDelayLeft) {} else this.processRow(); }
    else this.effectsTick();
    this.tick++;
    if (this.tick >= this.speed) {
      this.tick = 0;
      if (this.patDelay) { this.patDelay--; this.patDelayLeft = true; return; }
      this.patDelayLeft = false;
      if (this.loopJump !== false) { this.row = this.loopJump; this.loopJump = false; return; }
      if (this.jumpPos >= 0) {
        this.pos = this.jumpPos; this.row = this.breakRow >= 0 ? this.breakRow : 0;
        this.jumpPos = -1; this.breakRow = -1;
        if (this.pos >= this.songLen) this.pos = 0;
        if (this.row > 63) this.row = 0;
        return;
      }
      this.row++;
      if (this.row >= 64) { this.row = 0; this.pos++; if (this.pos >= this.songLen) this.pos = 0; }
    }
  }
  render(L, R, n) {
    let i = 0;
    while (i < n) {
      if (this.tickLeft <= 0) { this.doTick(); this.tickLeft += this.rate * 2.5 / this.tempo; }
      const todo = Math.min(n - i, Math.ceil(this.tickLeft));
      for (let k = 0; k < todo; k++) { L[i + k] = 0; R[i + k] = 0; }
      if (!this.musicMuted && this.playing) {
        for (const c of this.ch) {
          if (!c.active || !c.s || c.outPeriod <= 0) continue;
          const s = c.s, data = s.data, step = this.periodFreq(c.outPeriod) / this.rate;
          const v = c.outVol / 64 * 0.32;
          const vl = v * (1 - c.pan) * 0.5 * 1.4, vr = v * (1 + c.pan) * 0.5 * 1.4;
          const loop = s.ll > 2, lend = s.ls + s.ll;
          let pos = c.pos;
          for (let k = 0; k < todo; k++) {
            if (loop) { while (pos >= lend) pos -= s.ll; }
            else if (pos >= s.len) { c.active = false; break; }
            const smp = data[pos | 0];
            L[i + k] += smp * vl; R[i + k] += smp * vr;
            pos += step;
          }
          c.pos = pos;
        }
      }
      const f = this.sfx;
      if (f.s && !this.sfxMuted) {
        const s = f.s, v = f.vol / 64 * 0.42;
        for (let k = 0; k < todo; k++) {
          if (f.pos >= s.len) { f.s = null; break; }
          const smp = s.data[f.pos | 0] * v;
          L[i + k] += smp; R[i + k] += smp;
          f.pos += f.step;
        }
      } else if (f.s && this.sfxMuted) { f.pos += f.step * todo; if (f.pos >= f.s.len) f.s = null; }
      for (let k = 0; k < todo; k++) {
        L[i + k] = Math.tanh(L[i + k]); R[i + k] = Math.tanh(R[i + k]);
      }
      i += todo; this.tickLeft -= todo;
    }
  }
}
