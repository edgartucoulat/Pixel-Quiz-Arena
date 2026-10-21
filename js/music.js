/* =========================================================================
 * PIXEL QUIZ ARENA - Musique chiptune générée (Web Audio API)
 *
 * Aucun fichier : chaque morceau est composé au chargement à partir d'une
 * grille d'accords et d'une graine (mélodie, basse, arpèges, batterie), puis
 * joué en boucle par un petit séquenceur. Le morceau de suspense accélère
 * avec le chrono. La musique baisse toute seule quand le présentateur parle.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };
  // Batterie sur 16 pas : k = grosse caisse, s = caisse claire, h = charleston.
  const DRUMS = {
    disco: ['x...x...x...x...', '....x.......x...', '..x...x...x...x.'],
    soft: ['x.......x.......', '....x.......x...', 'x.x.x.x.x.x.x.x.'],
    half: ['x.........x.....', '........x.......', 'x.x.x.x.x.x.x.x.'],
    drive: ['x...x...x...x...', '....x.......x..x', 'xxxxxxxxxxxxxxxx'],
    epic: ['x..x..x...x.x...', '....x.......x...', 'x...x...x...x...'],
    shuffle: ['x.....x...x.....', '....x.......x...', 'x..x..x.x..x..x.'],
  };
  const RHYTHMS = ['x.x.x.x.x...x.x.', 'x..x..x.x.x.x...', 'x.xxx.x.x...x...', 'x...x.x.x.x.x...', 'x.x...x.xx.x....', 'x..x..x...x.x.x.'];

  // prog : degrés des accords (0 = tonique), un accord par mesure.
  const TRACKS = {
    theme: { bpm: 132, key: 60, scale: 'major', prog: [0, 5, 3, 4], seed: 3, drums: 'disco', bass: 'octave' },
    leaderboard: { bpm: 104, key: 65, scale: 'major', prog: [0, 3, 5, 4], seed: 11, drums: 'soft', bass: 'walk' },
    finale: { bpm: 140, key: 62, scale: 'major', prog: [0, 4, 5, 3], seed: 21, drums: 'disco', bass: 'octave' },
    round_mystere: { bpm: 112, key: 57, scale: 'dorian', prog: [0, 3, 0, 6], seed: 5, drums: 'half', bass: 'pulse' },
    round_fourchette: { bpm: 120, key: 62, scale: 'mixolydian', prog: [0, 6, 3, 0], seed: 7, drums: 'shuffle', bass: 'octave' },
    round_indices: { bpm: 126, key: 64, scale: 'minor', prog: [0, 5, 2, 6], seed: 9, drums: 'drive', bass: 'pulse' },
    round_quatre: { bpm: 150, key: 60, scale: 'major', prog: [0, 4, 5, 4], seed: 13, drums: 'drive', bass: 'octave' },
    round_eclair: { bpm: 144, key: 67, scale: 'major', prog: [0, 3, 4, 3], seed: 15, drums: 'disco', bass: 'octave' },
    round_table: { bpm: 108, key: 58, scale: 'major', prog: [0, 5, 1, 4], seed: 17, drums: 'soft', bass: 'walk' },
    round_echelle: { bpm: 118, key: 55, scale: 'minor', prog: [0, 5, 6, 4], seed: 19, drums: 'epic', bass: 'half' },
    round_duel: { bpm: 160, key: 57, scale: 'minor', prog: [0, 0, 5, 6], seed: 23, drums: 'drive', bass: 'pulse' },
    suspense: { bpm: 100, key: 57, scale: 'minor', suspense: true, flex: true },
  };

  function rng(seed) {
    return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** Compose un morceau : tableaux d'événements indexés par pas de double croche. */
  function build(def) {
    if (def.song) return def.song;
    const sc = SCALES[def.scale];
    const note = (deg, base) => base + 12 * Math.floor(deg / 7) + sc[((deg % 7) + 7) % 7];
    if (def.suspense) {
      // Ostinato inquiétant sur deux mesures : basse obstinée et petite cloche.
      const len = 32, s = { len, lead: [], arp: [], bass: [], drums: [] };
      for (let i = 0; i < len; i++) {
        const bar2 = i >= 16;
        if (i % 2 === 0) s.bass[i] = { f: mtof(def.key - 24 + (bar2 ? (i % 8 === 6 ? 1 : 0) - 4 : (i % 8 === 6 ? 12 : 0))), d: 1.6 };
        if ([0, 3, 6, 8, 11, 14].includes(i % 16)) s.lead[i] = { f: mtof(def.key + 12 + (i % 16 === 14 ? 1 : i % 16 === 6 ? 3 : 0)), d: 1, v: 0.6 };
        s.drums[i] = (i % 8 === 0 ? 'k' : '') + 'h' + (bar2 && i % 8 === 4 ? 's' : '');
      }
      return (def.song = s);
    }
    const rnd = rng(def.seed);
    const len = 8 * 16, s = { len, lead: [], arp: [], bass: [], drums: [] };
    const chordAt = (bar) => def.prog[bar % def.prog.length];
    // Mélodie : notes de l'accord sur les temps, mouvements conjoints ailleurs.
    const R1 = RHYTHMS[Math.floor(rnd() * RHYTHMS.length)], R2 = RHYTHMS[Math.floor(rnd() * RHYTHMS.length)];
    let prev = 9;
    const bars = [];
    const genBar = (bar, rhythm) => {
      const c = chordAt(bar), out = [];
      const onsets = [...rhythm].map((ch, i) => (ch === 'x' ? i : -1)).filter((i) => i >= 0);
      onsets.forEach((st, k) => {
        const nx = k + 1 < onsets.length ? onsets[k + 1] : 16;
        let deg;
        if (st % 4 === 0) {
          const cands = [];
          for (let d = 5; d <= 17; d++) if ([c, c + 2, c + 4].some((t) => (((d - t) % 7) + 7) % 7 === 0)) cands.push(d);
          cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
          deg = cands[Math.min(cands.length - 1, Math.floor(rnd() * rnd() * 3))];
        } else {
          const moves = [-1, 1, -1, 1, -2, 2, 0, 3, -3];
          deg = Math.max(5, Math.min(17, prev + moves[Math.floor(rnd() * moves.length)]));
        }
        prev = deg;
        out.push({ st, deg, d: Math.min(nx - st, 4) });
      });
      return out;
    };
    bars[0] = genBar(0, R1); bars[1] = genBar(1, R1); bars[2] = genBar(2, R2); bars[3] = genBar(3, R1);
    bars[4] = bars[0]; bars[5] = bars[1]; bars[6] = genBar(6, R2);
    bars[7] = [{ st: 0, deg: 7, d: 8 }, { st: 12, deg: 9, d: 2 }, { st: 14, deg: 11, d: 2 }]; // cadence
    bars.forEach((b, bar) => b.forEach((n) => (s.lead[bar * 16 + n.st] = { f: mtof(note(n.deg, def.key)), d: n.d })));
    const [K, S, H] = DRUMS[def.drums];
    for (let bar = 0; bar < 8; bar++) {
      const c = chordAt(bar), root = note(c, def.key - 24);
      const third = note(c + 2, def.key - 24), fifth = note(c + 4, def.key - 24);
      for (let i = 0; i < 16; i++) {
        const st = bar * 16 + i;
        // Basse
        let b = null;
        if (def.bass === 'octave' && i % 2 === 0) b = { m: (i / 2) % 2 ? root + 12 : root, d: 1.8 };
        if (def.bass === 'pulse' && i % 2 === 0) b = { m: root, d: 1.5 };
        if (def.bass === 'walk' && i % 4 === 0) b = { m: [root, third, fifth, i === 12 && bar % 4 === 3 ? root - 1 : fifth + 2][i / 4], d: 3.6 };
        if (def.bass === 'half' && i % 8 === 0) b = { m: i ? fifth : root, d: 7.5 };
        if (b) s.bass[st] = { f: mtof(b.m), d: b.d };
        // Arpège discret deux octaves au-dessus de la basse
        s.arp[st] = mtof([root, third, fifth, root + 12][i % 4] + 24);
        s.drums[st] = (K[i] === 'x' ? 'k' : '') + (S[i] === 'x' ? 's' : '') + (H[i] === 'x' ? 'h' : '');
      }
      if (bar === 7) s.drums[bar * 16 + 12] += 's', s.drums[bar * 16 + 14] += 's', s.drums[bar * 16 + 15] += 's'; // relance
    }
    return (def.song = s);
  }

  // Petits morceaux joués une fois (ouverture, manche, victoire). [mélodie, basse], une note par pas.
  const STINGS = {
    opening: { bpm: 150, lead: [72, 0, 72, 76, 79, 0, 76, 79, 84, 0, 0, 83, 84, 0, 0, 0, 79, 81, 83, 84, 0, 88, 0, 0, 91, 0, 0, 0], bass: [48, 0, 48, 0, 55, 0, 55, 0, 60, 60, 0, 59, 60, 0, 0, 0, 53, 0, 55, 0, 57, 0, 59, 0, 60, 0, 0, 0], drums: 'k.s.k.s.k.s.ksss k.s.k.ssk...' },
    round: { bpm: 170, lead: [67, 72, 76, 79, 76, 79, 84, 0, 0, 0], bass: [43, 0, 48, 0, 52, 0, 55, 0, 0, 0], drums: 'k...k.s.ks' },
    victory: { bpm: 140, lead: [72, 72, 72, 77, 0, 81, 0, 79, 81, 84, 0, 0, 0, 0, 84, 83, 81, 79, 77, 79, 81, 77, 84, 0, 0, 0, 0, 0, 0, 0], bass: [48, 0, 48, 53, 0, 57, 0, 55, 57, 60, 0, 0, 53, 0, 53, 0, 50, 0, 55, 0, 53, 0, 48, 0, 0, 0, 0, 0, 0, 0], drums: 'k.k.s.k.ksssk.s.k.s.k.s.kssssk' },
  };

  function pulseWave(ctx, duty) {
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    return ctx.createPeriodicWave(re, im);
  }

  class Music {
    constructor() {
      this.ctx = null;
      this.volume = 0.5;
      this.tempo = 1;
      this.cur = null;
      this.hold = 0;
    }
    /** Branché par PQA.sfx.unlock() sur le même AudioContext. */
    attach(ctx, noiseBuf) {
      if (this.ctx) return;
      this.ctx = ctx;
      this.noiseBuf = noiseBuf;
      this.out = ctx.createGain();
      this.out.gain.value = this.volume;
      this.duckG = ctx.createGain();
      this.out.connect(this.duckG);
      this.duckG.connect(ctx.destination);
      this.w25 = pulseWave(ctx, 0.25);
      this.w12 = pulseWave(ctx, 0.125);
      setInterval(() => this.pump(), 25);
      if (this.wanted) this.play(this.wanted);
    }
    setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    /** Baisse la musique sous la voix du présentateur. */
    setDuck(on) { if (this.ctx) this.duckG.gain.setTargetAtTime(on ? 0.28 : 1, this.ctx.currentTime, on ? 0.06 : 0.5); }

    /** Lance un morceau en boucle (null = silence). Ne fait rien si c'est déjà lui. */
    play(name, delay = 0) {
      this.wanted = name;
      if (!this.ctx || (this.cur && this.cur.name === name) || (!this.cur && !name)) return;
      this.fadeOut();
      const def = name && TRACKS[name];
      if (!def) return;
      const t = this.ctx.currentTime;
      const start = Math.max(t + 0.05 + delay, this.hold);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(1, start + 0.4);
      g.connect(this.out);
      this.cur = { name, def, song: build(def), step: 0, next: start, gain: g };
    }
    fadeOut() {
      const c = this.cur;
      this.cur = null;
      if (!c) return;
      const t = this.ctx.currentTime, gg = c.gain.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(gg.value, t);
      gg.linearRampToValueAtTime(0, t + 0.35);
      setTimeout(() => c.gain.disconnect(), 1000);
    }
    stepDur(def) { return 60 / (def.bpm * (def.flex ? this.tempo : 1)) / 4; }

    pump() {
      const c = this.cur;
      if (!c) return;
      const now = this.ctx.currentTime;
      if (c.next < now - 0.3) c.next = now + 0.05; // onglet en veille : on recale
      while (c.next < now + 0.15) {
        this.playStep(c, c.step, c.next);
        c.next += this.stepDur(c.def);
        c.step = (c.step + 1) % c.song.len;
      }
    }
    playStep(c, i, t) {
      const s = c.song, dur = this.stepDur(c.def), out = c.gain;
      const L = s.lead[i];
      if (L) {
        this.note(out, this.w25, L.f, t, L.d * dur * 0.9, 0.055 * (L.v || 1));
        this.note(out, this.w25, L.f, t + dur * 3, L.d * dur * 0.8, 0.016 * (L.v || 1)); // écho
      }
      if (s.arp[i]) this.note(out, this.w12, s.arp[i], t, dur * 0.6, 0.014);
      const B = s.bass[i];
      if (B) this.note(out, 'triangle', B.f, t, B.d * dur, 0.16);
      let d = s.drums[i] || '';
      if (c.def.flex && this.tempo > 1.4 && i % 4 === 2) d += 's'; // le suspense monte
      if (d.includes('k')) this.kick(out, t);
      if (d.includes('s')) this.snare(out, t);
      if (d.includes('h')) this.hat(out, t, c.def.flex ? 0.025 : 0.018);
    }

    /* ---- Instruments ---- */
    note(out, wave, f, t, dur, vol) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.005);
      g.gain.setTargetAtTime(vol * 0.6, t + 0.01, 0.08);
      g.gain.setValueAtTime(vol * 0.6, t + Math.max(0.02, dur - 0.02));
      g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
    noise(out, t, dur, vol, type, freq) {
      const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.noiseBuf;
      f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
    kick(out, t) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.2);
    }
    snare(out, t) { this.noise(out, t, 0.12, 0.09, 'bandpass', 1900); this.note(out, 'triangle', 190, t, 0.05, 0.05); }
    hat(out, t, vol) { this.noise(out, t, 0.03, vol, 'highpass', 7500); }

    /** Morceau court joué une fois ; la boucle reprend après. */
    sting(name) {
      const S = STINGS[name];
      if (!this.ctx || !S) return;
      const t0 = this.ctx.currentTime + 0.03;
      if (t0 < this.hold) return; // une autre fanfare est en cours
      const wanted = this.cur && this.cur.name;
      this.fadeOut();
      const dur = 60 / S.bpm / 2; // croches
      const out = this.ctx.createGain();
      out.connect(this.out);
      S.lead.forEach((m, i) => m && this.note(out, this.w25, mtof(m), t0 + i * dur, dur * 0.95, 0.07));
      S.lead.forEach((m, i) => m && this.note(out, this.w12, mtof(m - 12), t0 + i * dur, dur * 0.9, 0.025));
      S.bass.forEach((m, i) => m && this.note(out, 'triangle', mtof(m - 12), t0 + i * dur, dur * 0.95, 0.18));
      [...S.drums].forEach((ch, i) => { const t = t0 + i * dur; if (ch === 'k') this.kick(out, t); if (ch === 's') this.snare(out, t); });
      const len = Math.max(S.lead.length, S.bass.length) * dur;
      this.hold = t0 + len;
      setTimeout(() => out.disconnect(), (len + 1) * 1000);
      if (wanted) this.play(wanted);
    }
  }

  PQA.MUSIC_TRACKS = TRACKS;
  PQA.music = new Music();
})();
