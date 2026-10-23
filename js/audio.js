/* =========================================================================
 * PIXEL QUIZ ARENA - Sons 8-bit générés avec la Web Audio API
 * Aucun fichier audio : tout est synthétisé (ondes carrées, triangle, bruit).
 * La musique (js/music.js) partage le même AudioContext, avec son propre volume.
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
        // iPhone : sans ce réglage, le bouton silencieux coupe tout le Web Audio
        // (voix enregistrées, musique, effets), alors qu'un <audio> passait.
        try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* Safari < 16.4 */ }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        // Petit buffer de bruit blanc réutilisé (tambour, applaudissements).
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        if (PQA.music) PQA.music.attach(this.ctx);
      }
      if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
        this.ctx.resume().catch((e) => console.warn('Reprise audio impossible', e));
      }
      if (PQA.music) PQA.music.resume();
      if (PQA.voice) PQA.voice.resume();
    }
    setVolume(v) { this.volume = v; this.muted = v === 0; if (this.master) this.master.gain.value = v; }
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
    /** Note avec vibrato (cuivres, voix). */
    vib(freq, start, dur, type, vol, rate = 6, depth = 8, slideTo) {
      if (!this.ok) return;
      const t = this.now + start;
      const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator(), ld = this.ctx.createGain(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      lfo.frequency.value = rate; ld.gain.value = depth;
      lfo.connect(ld); ld.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
      g.gain.setValueAtTime(vol, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
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
    /** Buzzer propre à chaque joueur : dix sons bien différents, selon sa couleur. */
    buzz(idx = 0) {
      const B = [
        () => { this.tone(880, 0, 0.12, 'square', 0.14); this.tone(880, 0.15, 0.25, 'square', 0.14); },
        () => { this.vib(220, 0, 0.5, 'sawtooth', 0.12, 9, 6); this.vib(277, 0, 0.5, 'sawtooth', 0.09, 9, 6); },
        () => this.tone(300, 0, 0.35, 'square', 0.16, 1400),
        () => this.tone(1600, 0, 0.35, 'square', 0.14, 200),
        () => { for (let i = 0; i < 8; i++) this.tone(i % 2 ? 784 : 1047, i * 0.045, 0.045, 'square', 0.12); },
        () => { [523, 659, 784].forEach((f) => this.tone(f, 0, 0.4, 'square', 0.08)); this.tone(1047, 0.05, 0.3, 'triangle', 0.1); },
        () => { this.tone(1319, 0, 0.6, 'sine', 0.18); this.tone(2637, 0, 0.3, 'sine', 0.06); this.tone(3951, 0, 0.15, 'sine', 0.03); },
        () => this.vib(392, 0, 0.45, 'sawtooth', 0.14, 7, 14),
        () => this.seq([392, 523, 659, 784, 1047], 0.04, 'square', 0.12),
        () => { this.noise(0, 0.1, 0.3, 4000, 'highpass'); this.tone(150, 0.02, 0.35, 'square', 0.18); this.tone(152, 0.02, 0.35, 'sawtooth', 0.1); },
      ];
      B[((idx % 10) + 10) % 10]();
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

    /** Roulement de tambour qui s'intensifie, puis coup de cymbale. */
    drumroll(dur = 2) {
      if (!this.ok) return;
      let t = 0, step = 0.07;
      while (t < dur) {
        const k = t / dur;
        this.noise(t, 0.07, 0.08 + k * 0.16, 1500 + k * 600);
        this.tone(110 + k * 30, t, 0.05, 'triangle', 0.05 + k * 0.05);
        t += step; step = Math.max(0.035, step * 0.97);
      }
      this.tone(90, dur, 0.4, 'sine', 0.3, 40);
      this.noise(dur, 1.4, 0.3, 5500, 'highpass');
      this.noise(dur, 0.6, 0.15, 3000);
    }
    /** Applaudissements du public : des centaines de claquements + rumeur. */
    applause(dur = 2.5, power = 1) {
      if (!this.ok) return;
      const n = Math.round(dur * 90 * power);
      for (let i = 0; i < n; i++) {
        const t = Math.pow(Math.random(), 1.4) * dur; // plus dense au début
        const fade = 1 - t / (dur + 0.4);
        this.noise(t, 0.015 + Math.random() * 0.03, (0.04 + Math.random() * 0.07) * fade * power, 1200 + Math.random() * 2600);
      }
      this.noise(0, dur, 0.05 * power, 900, 'lowpass');
    }
    /** Le « ooooh » déçu du public : des voix synthétiques qui descendent. */
    ooh(power = 1) {
      if (!this.ok) return;
      const t = this.now;
      const dur = 1.5;
      const out = this.ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.35 * power, t + 0.15);
      out.gain.setValueAtTime(0.35 * power, t + 0.7);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // Formants d'un « o » : environ 450 Hz et 800 Hz.
      const f1 = this.ctx.createBiquadFilter(), f2 = this.ctx.createBiquadFilter();
      f1.type = f2.type = 'bandpass';
      f1.frequency.value = 450; f1.Q.value = 4;
      f2.frequency.value = 800; f2.Q.value = 6;
      const mix = this.ctx.createGain();
      mix.connect(f1); mix.connect(f2); f1.connect(out); f2.connect(out); out.connect(this.master);
      for (let i = 0; i < 12; i++) {
        const base = (i % 2 ? 180 : 110) * (0.9 + Math.random() * 0.3);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth';
        const s0 = t + Math.random() * 0.12;
        o.frequency.setValueAtTime(base * 1.12, s0);
        o.frequency.linearRampToValueAtTime(base * 1.18, s0 + 0.25);
        o.frequency.exponentialRampToValueAtTime(base * 0.8, t + dur);
        g.gain.value = 0.12;
        o.connect(g); g.connect(mix);
        o.start(s0); o.stop(t + dur + 0.05);
      }
    }
    /** Le « wouaaah » admiratif du public. */
    wow(power = 1) {
      if (!this.ok) return;
      const t = this.now, dur = 1.3;
      const out = this.ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.3 * power, t + 0.35);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(1100, t + 0.5); // « ou » vers « a »
      f.connect(out); out.connect(this.master);
      for (let i = 0; i < 12; i++) {
        const base = (i % 2 ? 190 : 120) * (0.9 + Math.random() * 0.3);
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(base, t);
        o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.6);
        o.connect(f); o.start(t + Math.random() * 0.1); o.stop(t + dur + 0.05);
      }
      this.applause(1.5, 0.5);
    }
    /** Faux départ : « bzzzt » grinçant et deux bips graves. */
    falseStart() {
      this.tone(140, 0, 0.3, 'sawtooth', 0.16, 70);
      this.tone(147, 0, 0.3, 'square', 0.1, 74);
      this.tone(196, 0.35, 0.1, 'square', 0.12);
      this.tone(131, 0.5, 0.2, 'square', 0.12);
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
    /** Victoire : fanfare (sur la musique) + ovation. */
    victory() {
      if (PQA.music && PQA.music.ctx) PQA.music.sting('victory'); else this.fanfare();
      this.applause(4, 1.3);
    }
    sadTrombone() { this.tone(392, 0, 0.35, 'sawtooth', 0.1, 370); this.tone(370, 0.4, 0.35, 'sawtooth', 0.1, 349); this.tone(349, 0.8, 0.9, 'sawtooth', 0.1, 300); }
  }

  PQA.sfx = new Sfx();
})();

