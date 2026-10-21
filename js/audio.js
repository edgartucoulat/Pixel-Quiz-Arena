/* =========================================================================
 * PIXEL QUIZ ARENA - Sons 8-bit générés avec la Web Audio API
 * Aucun fichier audio : tout est synthétisé (ondes carrées, triangle, bruit).
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  class Sfx {
    constructor() {
      this.ctx = null;
      this.volume = 0.5;
      this.muted = false;
    }
    /** À appeler depuis un clic (les navigateurs bloquent l'audio sinon). */
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        // Petit buffer de bruit blanc réutilisé (tambour, applaudissements).
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
    get ok() { return this.ctx && !this.muted; }
    get now() { return this.ctx.currentTime; }

    /** Joue une note. type: square | triangle | sawtooth | sine */
    tone(freq, start, dur, type = 'square', vol = 0.15, slideTo) {
      if (!this.ok) return;
      const t = this.now + start;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noise(start, dur, vol = 0.2, filterFreq = 2000, type = 'bandpass') {
      if (!this.ok) return;
      const t = this.now + start;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = filterFreq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
    seq(notes, step = 0.1, type = 'square', vol = 0.12) {
      notes.forEach((n, i) => n && this.tone(n, i * step, step * 0.95, type, vol));
    }

    // ---- Effets ----------------------------------------------------------
    /** Buzzer propre à chaque joueur (hauteur et timbre selon son numéro). */
    buzz(idx = 0) {
      const base = [196, 233, 262, 294, 330, 349, 392, 440, 494, 523][idx % 10];
      const type = ['square', 'sawtooth', 'square', 'triangle'][idx % 4];
      this.tone(base, 0, 0.35, type, 0.2);
      this.tone(base * 1.5, 0, 0.35, 'square', 0.08);
      this.tone(base * 2, 0.05, 0.25, type, 0.06);
    }
    correct() { this.seq([523, 659, 784, 1047], 0.08, 'square', 0.12); this.tone(1047, 0.32, 0.3, 'triangle', 0.12); }
    wrong() { this.tone(220, 0, 0.18, 'sawtooth', 0.16); this.tone(160, 0.18, 0.4, 'sawtooth', 0.16, 90); }
    tick(high) { this.tone(high ? 1400 : 1000, 0, 0.03, 'square', 0.05); }
    blip() { this.tone(600 + Math.random() * 300, 0, 0.025, 'square', 0.03); }
    pop() { this.tone(400, 0, 0.08, 'square', 0.1, 900); }
    coin() { this.tone(988, 0, 0.07, 'square', 0.1); this.tone(1319, 0.07, 0.25, 'square', 0.1); }
    join() { this.seq([392, 523, 659], 0.07, 'triangle', 0.15); }
    select() { this.tone(660, 0, 0.06, 'square', 0.08); this.tone(880, 0.06, 0.08, 'square', 0.08); }
    lock() { this.tone(300, 0, 0.05, 'square', 0.06); }
    whoosh() { this.noise(0, 0.35, 0.15, 800, 'lowpass'); }
    explosion() { this.noise(0, 0.8, 0.4, 500, 'lowpass'); this.tone(120, 0, 0.6, 'sawtooth', 0.15, 40); }
    freeze() { this.seq([1568, 1319, 1175, 988, 784], 0.05, 'triangle', 0.1); }
    card() { this.seq([330, 0, 494, 659, 988], 0.06, 'square', 0.1); }
    fire() { this.tone(200, 0, 0.5, 'sawtooth', 0.1, 1200); this.noise(0, 0.5, 0.15, 3000); }
    hit() { this.noise(0, 0.15, 0.4, 1200); this.tone(150, 0, 0.15, 'square', 0.2, 60); }
    ko() { this.tone(400, 0, 1.2, 'sawtooth', 0.15, 40); this.noise(0, 1, 0.3, 400, 'lowpass'); }
    wheelTick() { this.tone(1800, 0, 0.015, 'square', 0.05); }

    /** Roulement de tambour qui accélère, puis cymbale. */
    drumroll(dur = 2) {
      if (!this.ok) return;
      let t = 0, step = 0.09;
      while (t < dur) { this.noise(t, 0.06, 0.12 + (t / dur) * 0.15, 1800); t += step; step = Math.max(0.03, step * 0.96); }
      this.noise(dur, 0.9, 0.3, 6000, 'highpass');
    }
    applause(dur = 2) {
      if (!this.ok) return;
      for (let i = 0; i < dur * 40; i++) this.noise(Math.random() * dur, 0.04, 0.05 + Math.random() * 0.06, 2500 + Math.random() * 2000);
    }
    /** Jingle d'ouverture de l'émission. */
    jingle() {
      const m = [523, 0, 523, 659, 784, 0, 659, 784, 1047, 0, 0, 988, 1047];
      this.seq(m, 0.11, 'square', 0.1);
      this.seq([131, 0, 131, 0, 196, 0, 196, 0, 262, 262, 0, 247, 262], 0.11, 'triangle', 0.18);
    }
    roundJingle() {
      this.seq([392, 523, 659, 784, 659, 784, 1047], 0.09, 'square', 0.1);
      this.seq([98, 0, 131, 0, 165, 0, 196], 0.09, 'triangle', 0.2);
    }
    fanfare() {
      this.seq([523, 523, 523, 698, 0, 880, 0, 784, 880, 1047], 0.12, 'square', 0.12);
      this.seq([262, 0, 262, 349, 0, 440, 0, 392, 440, 523], 0.12, 'triangle', 0.18);
      this.applause(3);
    }
    sadTrombone() { this.tone(392, 0, 0.35, 'sawtooth', 0.1, 370); this.tone(370, 0.4, 0.35, 'sawtooth', 0.1, 349); this.tone(349, 0.8, 0.9, 'sawtooth', 0.1, 300); }
  }

  PQA.sfx = new Sfx();
})();
