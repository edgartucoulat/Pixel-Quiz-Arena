/* =========================================================================
 * PIXEL QUIZ ARENA - Musique de l'émission (Web Audio API)
 *
 * Fonds musicaux : de vrais morceaux enregistrés (Kevin MacLeod, CC BY 4.0,
 * scripts/import_music.py), joués en boucle. Jingles télé (ouverture, annonce
 * de chaque manche, victoire) composés par scripts/compose_music.py.
 * La musique de réflexion accélère quand le chrono s'épuise, et tout baisse
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
        .then((m) => { this.loops = m.loops || {}; (m.cues || []).filter((n) => !this.loops[n]).forEach((n) => this.load(n)); })
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
    setDuck(on) { if (this.ctx) this.duckG.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, on ? 0.06 : 0.3); }

    /** 1 = calme ... ~1.85 = chrono presque écoulé (réglé à chaque image par le plateau). */
    set tempo(v) {
      const k = Math.max(0, Math.min(1, (v - 1) / 0.85));
      if (Math.abs(k - this.intensity) < 0.02) return;
      this.intensity = k;
      const c = this.cur;
      if (!c || c.name !== 'suspense' || !this.ctx) return;
      // Le morceau accélère quand le chrono s'épuise.
      c.audio.playbackRate = 1 + k * 0.06;
    }
    get tempo() { return 1 + this.intensity * 0.85; }

    /**
     * Lance une ambiance en boucle (null = silence). Ne fait rien si c'est déjà elle.
     * Les fonds sont de longs morceaux : lus en flux par un <audio> plutôt que
     * décodés en entier (des centaines de Mo en mémoire sur un téléphone).
     */
    play(name, delay = 0) {
      this.wanted = name;
      if (!this.ctx || (this.cur && this.cur.name === name) || (!this.cur && !name)) return;
      this.fadeOut();
      if (!name) return;
      const file = name.startsWith('round_') ? BEDS[name.slice(6)] || 'bed1' : name;
      const a = new Audio(DIR + file + '.webm');
      a.loop = true;
      a.preload = 'auto';
      if (name === 'suspense') a.playbackRate = 1 + this.intensity * 0.06;
      const c = (this.cur = { name, audio: a });
      const g = (c.gain = this.ctx.createGain());
      g.gain.value = 0;
      c.src = this.ctx.createMediaElementSource(a);
      c.src.connect(g);
      g.connect(this.out);
      const wait = Math.max(0.05 + delay, this.hold - this.ctx.currentTime);
      c.timer = setTimeout(() => {
        if (this.cur !== c) return;
        a.play().catch(() => {});
        const t = this.ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 1.2);
      }, wait * 1000);
    }
    fadeOut() {
      const c = this.cur;
      this.cur = null;
      if (!c) return;
      clearTimeout(c.timer);
      const t = this.ctx.currentTime, gg = c.gain.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(gg.value, t);
      gg.linearRampToValueAtTime(0, t + 0.6);
      setTimeout(() => { c.audio.pause(); c.audio.removeAttribute('src'); c.audio.load(); c.src.disconnect(); c.gain.disconnect(); }, 900);
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
