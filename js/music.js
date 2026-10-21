/* =========================================================================
 * PIXEL QUIZ ARENA - Musique de l'émission (Web Audio API)
 *
 * Musiques originales jouées par de vrais instruments (orchestre, cuivres,
 * piano), composées et enregistrées par scripts/compose_music.py dans
 * audio/music/ : des ambiances discrètes en boucle et des jingles télé
 * (ouverture, annonce de chaque manche, victoire).
 * La musique de réflexion se tend quand le chrono s'épuise, et tout baisse
 * quand le présentateur parle.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  const DIR = 'audio/music/';
  // Fond musical de chaque manche (trois ambiances différentes).
  const BEDS = { sprint: 'bed3', mystere: 'bed1', eclair: 'bed3', table: 'bed1', quatre: 'bed2', fourchette: 'bed2', champions: 'bed3', duel: 'bed3' };
  const ALIAS = { round: 'transition' };

  class Music {
    constructor() {
      this.ctx = null;
      this.volume = 0.5;
      this.intensity = 0;
      this.cur = null;
      this.hold = 0;
      this.buffers = {};
      this.loops = {};
    }
    /** Branché par PQA.sfx.unlock() sur le même AudioContext. */
    attach(ctx) {
      if (this.ctx) return;
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = this.volume;
      this.duckG = ctx.createGain();
      this.out.connect(this.duckG);
      this.duckG.connect(ctx.destination);
      this.ready = fetch(DIR + 'manifest.json')
        .then((r) => r.json())
        .then((m) => { this.loops = m.loops || {}; (m.cues || []).forEach((n) => this.load(n)); })
        .catch(() => {});
      if (this.wanted) this.play(this.wanted);
    }
    load(name) {
      if (!this.buffers[name]) {
        this.buffers[name] = fetch(DIR + name + '.webm')
          .then((r) => r.arrayBuffer())
          .then((b) => new Promise((ok, ko) => this.ctx.decodeAudioData(b, ok, ko)))
          .catch(() => null);
      }
      return this.buffers[name];
    }
    setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    /** Baisse la musique sous la voix du présentateur. */
    setDuck(on) { if (this.ctx) this.duckG.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, on ? 0.08 : 0.5); }

    /** 1 = calme ... ~1.85 = chrono presque écoulé (réglé à chaque image par le plateau). */
    set tempo(v) {
      const k = Math.max(0, Math.min(1, (v - 1) / 0.85));
      if (Math.abs(k - this.intensity) < 0.02) return;
      this.intensity = k;
      const c = this.cur;
      if (!c || c.name !== 'suspense' || !this.ctx) return;
      const t = this.ctx.currentTime;
      // La version tendue monte, et le tout accélère légèrement.
      c.layers[0].g.gain.setTargetAtTime(1 - k * 0.6, t, 0.3);
      c.layers[1].g.gain.setTargetAtTime(k, t, 0.3);
      c.layers.forEach((l) => l.src.playbackRate.setTargetAtTime(1 + k * 0.07, t, 0.5));
    }
    get tempo() { return 1 + this.intensity * 0.85; }

    /** Lance une ambiance en boucle (null = silence). Ne fait rien si c'est déjà elle. */
    play(name, delay = 0) {
      this.wanted = name;
      if (!this.ctx || (this.cur && this.cur.name === name) || (!this.cur && !name)) return;
      this.fadeOut();
      if (!name) return;
      const files = name === 'suspense' ? ['suspense1', 'suspense2'] : [name.startsWith('round_') ? BEDS[name.slice(6)] || 'bed1' : name];
      const c = (this.cur = { name, layers: [] });
      const g = (c.gain = this.ctx.createGain());
      g.gain.value = 0;
      g.connect(this.out);
      Promise.all(files.map((f) => this.load(f))).then((bufs) => {
        if (this.cur !== c || bufs.some((b) => !b)) return;
        const t = this.ctx.currentTime;
        const start = Math.max(t + 0.05 + delay, this.hold);
        bufs.forEach((buf, i) => {
          const src = this.ctx.createBufferSource(), lg = this.ctx.createGain();
          src.buffer = buf;
          src.loop = true;
          src.loopEnd = Math.min(buf.duration, this.loops[files[i]] || buf.duration);
          lg.gain.value = name === 'suspense' ? (i ? this.intensity : 1 - this.intensity * 0.6) : 1;
          src.connect(lg); lg.connect(g);
          src.start(start);
          c.layers.push({ src, g: lg });
        });
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(1, start + 1.2);
      });
    }
    fadeOut() {
      const c = this.cur;
      this.cur = null;
      if (!c) return;
      const t = this.ctx.currentTime, gg = c.gain.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(gg.value, t);
      gg.linearRampToValueAtTime(0, t + 0.6);
      setTimeout(() => { c.layers.forEach((l) => { try { l.src.stop(); } catch (e) {} }); c.gain.disconnect(); }, 900);
    }

    /** Jingle joué une fois (ouverture, annonce de manche, victoire...) ; l'ambiance reprend après. */
    sting(name) {
      name = ALIAS[name] || name;
      if (!this.ctx) return;
      if (this.ctx.currentTime < this.hold - 0.5) return; // un autre jingle est en cours
      this.fadeOut();
      this.hold = this.ctx.currentTime + 1; // en attendant le décodage
      this.load(name).then((buf) => {
        if (!buf) { this.hold = 0; return; }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.out);
        const t = this.ctx.currentTime + 0.02;
        src.start(t);
        this.hold = t + buf.duration - 0.6; // l'ambiance revient pendant la queue du jingle
        const w = this.wanted;
        this.fadeOut();
        if (w) this.play(w);
      });
    }
  }

  PQA.music = new Music();
})();
