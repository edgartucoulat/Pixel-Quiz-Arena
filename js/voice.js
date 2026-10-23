/* =========================================================================
 * PIXEL QUIZ ARENA - Voix du présentateur
 *
 * Deux sources, choisies pour sonner le moins robotique possible :
 *  1. La banque enregistrée (audio/voice/*.webm) : les répliques fixes, les
 *     questions, les indices et les anecdotes, pré-générés avec une voix
 *     neuronale gratuite (scripts/gen_voice.py, lancé par GitHub Actions).
 *  2. La synthèse vocale du navigateur, mais seulement avec une voix
 *     « naturelle » (Edge : « Microsoft … Online (Natural) », Safari : voix
 *     Premium/Améliorée). C'est elle qui dit les prénoms des joueurs.
 * Les voix système robotiques ne servent qu'en secours, si on l'active.
 *
 * Les fichiers sont nommés par une empreinte du texte affiché : si une
 * question change, son ancien fichier n'est plus utilisé, jamais faux.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  const BANK_DIR = 'audio/voice/';
  // Doit correspondre à la voix de scripts/gen_voice.py : en direct, on
  // préfère la même voix pour que les deux sources ne s'entendent pas.
  const BANK_VOICE = /fabrice/i;

  const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  /** Empreinte d'un texte (FNV-1a 32 bits) = nom du fichier enregistré. */
  function key(text) {
    const s = norm(text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Texte réellement prononcé : sans émojis, et sans les MAJUSCULES des
   * répliques (une voix lit « BOUM » comme un sigle). Les questions gardent
   * leurs majuscules (sigles, chiffres romains).
   */
  function prepare(text, kind) {
    let s = norm(text)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\.\.\./g, '…')
      .replace(/\bx(\d)\b/g, (_, n) => 'fois ' + (['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq'][n] || n))
      .replace(/\b50\/50\b/g, 'cinquante-cinquante');
    if (kind !== 'question') {
      // « Désolé… enfin, pas tant que ça » : les points de suspension font une
      // longue pause qui casse la phrase. Une virgule enchaîne naturellement.
      // (Pas dans les questions : « Complétez : … » y marque un blanc.)
      s = s.replace(/\s*…\s*(?=\p{Ll})/gu, ', ').replace(/\s*…\s*$/u, '.')
        .replace(/(?<!\p{L})\p{Lu}{3,}(?!\p{L})/gu, (w) => (w === 'QCM' ? w : w.toLowerCase()))
        .replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_, a, b) => a + b.toUpperCase());
    }
    return norm(s);
  }

  /** Découpe en phrases (on peut ainsi enchaîner « Le saviez-vous ? » + anecdote). */
  function chunks(text) {
    // On ne coupe pas devant une minuscule (« Désolé... enfin, pas tant que ça. ») :
    // c'est la même phrase, dite d'un seul souffle.
    return norm(text).split(/(?<=[.!?:…»])\s+(?=[^\s\p{Ll}])/u).filter(Boolean);
  }

  /** Note d'une voix du navigateur : plus c'est haut, plus elle est naturelle. */
  function score(v) {
    if (!/^fr/i.test(v.lang)) return -1;
    const n = v.name;
    let s = 0;
    if (/natural|neural|online/i.test(n)) s += 100;
    else if (/premium|enhanced|amélioré/i.test(n)) s += 85;
    else if (/google/i.test(n)) s += 40;
    if (/fr[-_]FR/i.test(v.lang)) s += 10;
    if (BANK_VOICE.test(n)) s += 30; // même voix que la banque
    return s;
  }
  const NATURAL = 80;

  const V = {
    enabled: true,
    volume: 1,
    choice: 'auto', // 'auto' | nom d'une voix du navigateur
    fallback: false, // autoriser une voix robotique quand rien de mieux n'existe
    bank: null, // Set des empreintes enregistrées
    voices: [], // voix françaises du navigateur, de la meilleure à la pire
    live: null,
    liveBroken: false,
    onTalk: null, // callback(bool) : la voix parle / se tait (pour baisser la musique)
    queue: [],
    playing: null,
    talking: false,
    buffers: new Map(), // Courtes voix décodées : cache borné, pas toute la banque en mémoire.

    init() {
      if (this.inited) return;
      this.inited = true;
      if ('speechSynthesis' in window) {
        const load = () => {
          this.voices = speechSynthesis.getVoices().filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a));
          this.pickLive();
          if (this.onVoices) this.onVoices();
        };
        load();
        speechSynthesis.addEventListener('voiceschanged', load);
      }
      fetch(BANK_DIR + 'manifest.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => { if (m && m.ids) { this.bank = new Set(m.ids); this.bankVoice = m.voice || ''; if (this.onVoices) this.onVoices(); } })
        .catch(() => {});
    },
    pickLive() {
      const chosen = this.choice !== 'auto' && this.voices.find((v) => v.name === this.choice);
      this.live = chosen || this.voices[0] || null;
    },
    has(text) { return !!(this.bank && this.bank.has(key(text))); },

    /**
     * Comment parler en ce moment. Pixou n'a qu'une voix (Fabrice) : avec la
     * banque enregistrée, le navigateur ne parle que s'il a cette même voix.
     */
    get mode() {
      const live = !this.liveBroken && this.live;
      const bank = this.bank && this.bank.size > 0;
      if (bank) return { bank: true, live: !!live && BANK_VOICE.test(live.name) && score(live) >= NATURAL };
      return { bank: false, live: !!live && (this.fallback || score(live) >= 40) };
    },
    /** Vrai quand les prénoms ne peuvent pas être dits joliment : on préfère alors les répliques enregistrées. */
    get preferRecorded() {
      const m = this.mode;
      return !!(this.enabled && m.bank && !(m.live && this.live && score(this.live) >= NATURAL));
    },
    get description() {
      const m = this.mode;
      const bank = this.bank && this.bank.size ? `voix enregistrée (${this.bank.size} phrases)` : '';
      const live = m.live && this.live ? `${this.live.name}${score(this.live) >= NATURAL ? '' : ' (robotique)'}` : '';
      if (m.bank && live) return bank + ' + ' + live;
      return (m.bank ? bank : live) || 'aucune voix disponible';
    },

    /** Découpe le texte en morceaux enregistrés / à synthétiser, ou null si on doit se taire. */
    plan(text, kind) {
      const m = this.mode;
      const parts = chunks(text);
      const segs = [];
      let i = 0;
      while (i < parts.length) {
        let found = -1;
        if (m.bank) for (let j = parts.length; j > i; j--) if (this.has(parts.slice(i, j).join(' '))) { found = j; break; }
        if (found > 0) { segs.push({ id: key(parts.slice(i, found).join(' ')), text: parts.slice(i, found).join(' '), kind }); i = found; continue; }
        if (!m.live) return null;
        segs.push({ text: prepare(parts[i], kind), kind });
        i++;
      }
      return segs.length ? segs : null;
    },

    /** Dit un texte. Sans `queue`, coupe ce qui était en cours. */
    speak(text, opts = {}) {
      if (!opts.queue) this.stop();
      if (!this.enabled || !text) return;
      const segs = this.plan(text, opts.kind);
      if (!segs) return;
      this.queue.push(...segs);
      if (!this.playing) this.next();
    },
    /** Une voix bloquée attend le prochain geste, tant que sa réplique est actuelle. */
    resume() {
      const p = this.playing;
      if (p && p.blocked && p.retry) p.retry();
    },
    stop() {
      this.queue = [];
      const p = this.playing;
      this.playing = null;
      if (p) { if (p.audio) { p.audio.onended = p.audio.onerror = null; p.audio.pause(); } clearTimeout(p.watch); }
      if (p && p.source) { p.source.onended = null; p.source.stop(); p.source.disconnect(); p.gain.disconnect(); }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      this.setTalking(false);
    },
    setTalking(on) {
      if (this.talking === on) return;
      this.talking = on;
      if (this.onTalk) this.onTalk(on);
    },
    loadRecorded(id, ctx) {
      if (!this.buffers.has(id)) {
        const pending = fetch(BANK_DIR + id + '.webm')
          .then((r) => { if (!r.ok) throw new Error('Voix HTTP ' + r.status); return r.arrayBuffer(); })
          .then((bytes) => new Promise((resolve, reject) => ctx.decodeAudioData(bytes, resolve,
            (e) => reject(Object.assign(new Error('Voix non décodable'), { name: 'DecodeError', cause: e })))))
          .catch((e) => { this.buffers.delete(id); throw e; });
        this.buffers.set(id, pending);
        if (this.buffers.size > 12) this.buffers.delete(this.buffers.keys().next().value);
      }
      return this.buffers.get(id);
    },
    /** Joue un morceau enregistré avec un lecteur <audio> (sans Web Audio, ou s'il ne décode pas le fichier). */
    playElement(seg, p, done) {
      const a = (p.audio = new Audio(BANK_DIR + seg.id + '.webm'));
      a.volume = Math.min(1, this.volume);
      a.onended = done;
      // Fichier illisible (navigateur sans Opus, réseau) : on tente le direct.
      a.onerror = () => { if (this.playing !== p) return; if (this.mode.live) { delete seg.id; this.queue.unshift({ text: prepare(seg.text, seg.kind), kind: seg.kind }); } done(); };
      p.retry = () => {
        p.blocked = false;
        a.play().catch((e) => {
          if (this.playing !== p) return;
          if (e.name === 'NotAllowedError') {
            p.blocked = true;
            this.setTalking(false);
          } else if (a.onerror) a.onerror();
        });
      };
      a.onplaying = () => { if (this.playing === p) this.setTalking(true); };
      p.retry();
      p.watch = setTimeout(done, 30000);
      // Précharge le morceau suivant.
      const nx = this.queue[0];
      if (nx && nx.id) { const pre = new Audio(BANK_DIR + nx.id + '.webm'); pre.preload = 'auto'; }
    },
    next() {
      const seg = this.queue.shift();
      if (!seg) { this.playing = null; this.setTalking(false); return; }
      this.setTalking(true);
      const p = (this.playing = { seg });
      const done = () => { if (this.playing === p) { clearTimeout(p.watch); this.next(); } };
      if (seg.id && PQA.sfx && PQA.sfx.ctx && !this.decodeBroken) {
        // Le contexte des effets est déverrouillé au toucher. Contrairement à un
        // nouvel élément Audio par phrase, les voix suivantes partagent ce contexte.
        const ctx = PQA.sfx.ctx;
        this.loadRecorded(seg.id, ctx).then((buffer) => {
          if (this.playing !== p) return; // question remplacée pendant le chargement
          clearTimeout(p.watch);
          const source = (p.source = ctx.createBufferSource());
          const gain = (p.gain = ctx.createGain());
          gain.gain.value = Math.max(0, Math.min(1, this.volume));
          source.buffer = buffer;
          source.connect(gain); gain.connect(ctx.destination);
          source.onended = () => { source.disconnect(); gain.disconnect(); done(); };
          source.start();
          // Pas de minuterie murale : un contexte suspendu reprend au prochain geste.
        }).catch((e) => {
          if (this.playing !== p) return;
          console.warn('Lecture de voix impossible', e);
          clearTimeout(p.watch);
          // Décodage refusé (WebM non pris en charge par le Web Audio de ce
          // navigateur) : le lecteur <audio> sait souvent lire le même fichier.
          if (e && e.name === 'DecodeError') this.decodeBroken = true;
          this.playElement(seg, p, done);
        });
        p.watch = setTimeout(done, 30000); // garde-fou réseau, annulé une fois décodé
        return;
      }
      if (seg.id) return this.playElement(seg, p, done);
      if (!('speechSynthesis' in window) || !this.live) return done();
      const u = (p.utter = new SpeechSynthesisUtterance(seg.text));
      u.voice = this.live;
      u.lang = this.live.lang;
      // Les voix neuronales sonnent faux dès qu'on touche à la hauteur :
      // on garde le ton naturel et on accélère un peu le débit, davantage
      // pour les répliques que pour les questions (comme la banque).
      const natural = score(this.live) >= NATURAL;
      u.rate = natural ? (seg.kind === 'question' ? 1.04 : 1.1) : 1.0;
      u.pitch = 1;
      u.volume = Math.min(1, this.volume);
      u.onend = done;
      u.onerror = (e) => {
        // Voix en ligne bloquée (pare-feu, hors ligne) : on n'insiste pas.
        if (e && /network|synthesis-unavailable|synthesis-failed/.test(e.error) && natural) { this.liveBroken = true; if (this.onVoices) this.onVoices(); }
        done();
      };
      p.watch = setTimeout(done, 4000 + seg.text.length * 110);
      speechSynthesis.speak(u);
    },
  };

  V.key = key;
  V.prepare = prepare;
  V.chunks = chunks;
  V.score = score;
  PQA.voice = V;
  // Ancienne interface, gardée pour le reste du code.
  PQA.tts = {
    get enabled() { return V.enabled; }, set enabled(b) { V.enabled = b; if (!b) V.stop(); },
    init: () => V.init(), speak: (t) => V.speak(t), stop: () => V.stop(),
  };
})();


