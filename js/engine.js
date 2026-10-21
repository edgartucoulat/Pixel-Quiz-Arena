/* =========================================================================
 * PIXEL QUIZ ARENA - Moteur de jeu (tourne sur l'Écran Plateau)
 *
 * C'est lui qui fait autorité : chronos, ordre des buzz (horodatage local +
 * compensation de latence mesurée), validation des réponses et scores.
 * Les téléphones ne reçoivent qu'une "vue" (ce qu'ils doivent afficher)
 * et n'envoient que des intentions (buzz, réponse, choix...).
 *
 * Le moteur ne touche pas au DOM : il appelle des hooks fournis par host.js
 *   hooks.changed()            -> l'état a changé (re-rendu + envoi des vues)
 *   hooks.fx(name, data)       -> effet ponctuel (son, animation)
 *   hooks.say(text, expr)      -> réplique du présentateur virtuel
 *   hooks.send(pid, msg)       -> message direct à un téléphone
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});
  const now = () => performance.now();
  const rand = (n) => Math.floor(Math.random() * n);
  const pickOne = (arr) => arr[rand(arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const ROUND_ORDER = ['mystere', 'fourchette', 'indices', 'quatre', 'eclair', 'table', 'echelle'];
  PQA.ROUND_ORDER = ROUND_ORDER;

  // Nombre de questions / tours par manche selon la durée choisie.
  const LENGTH = {
    court: { eclair: 5, fourchette: 3, indices: 4, mystereTurns: 1, table: [3, 3], quatre: 2 },
    normal: { eclair: 8, fourchette: 5, indices: 6, mystereTurns: 1, table: [4, 3], quatre: 3 },
    long: { eclair: 12, fourchette: 7, indices: 8, mystereTurns: 2, table: [4, 4], quatre: 4 },
  };

  const TIMES = {
    eclair: 15000, fourchette: 30000, single: 25000, singleLibre: 35000,
    level: 20000, buzzAnswer: 15000, buzzAnswerIRL: 20000, clue: 6500, afterLastClue: 9000,
    ladder: 60000, vote: 15000, friend: 30000, quatre: 40000, board: 25000, target: 15000,
    duelBuzz: 15000, duelAnswer: 8000,
  };

  /* Anti-buzz au hasard : buzz raté = pénalité, faux départ = buzzer bloqué,
   * et peu de temps pour répondre une fois qu'on a buzzé. */
  const BUZZ = {
    penalty: 100,      // points perdus sur un buzz raté (ou sans réponse à temps)
    duelPenalty: 10,   // en duel : points de vie perdus
    falseStart: 2000,  // buzzer bloqué après un buzz trop tôt
    answer: 5000,      // temps pour répondre après le buzz (choix)
    answerText: 10000, // ... quand il faut taper la réponse
  };
  /** Temps de lecture avant l'ouverture des buzzers, selon la longueur du texte. */
  const readTime = (text) => clamp(String(text || '').length * 35, 1500, 4000);

  class Game {
    constructor(bank, categories, hooks) {
      this.bank = bank;
      this.categories = categories; // [{name, icon}]
      this.hooks = hooks;
      this.players = {}; // id -> joueur
      this.order = []; // ordre d'arrivée
      this.presenter = { connected: false };
      this.settings = {
        mode: 'virtual', // virtual | irl | duel
        teams: 0, // 0 = sans équipes, sinon 2 à 4
        rounds: ['mystere', 'fourchette', 'indices', 'eclair', 'table', 'echelle'],
        length: 'normal',
        finale: 'solo', // solo | duo
        cards: true,
        localDuel: false,
      };
      this.phase = 'lobby';
      this.round = null;
      this.q = null;
      this.timer = null;
      this.jobs = [];
      this.paused = false;
      this.used = new Set();
      this.nextId = 1;
      this.seq = 0; // compteur de changements (clé de rendu)
      this.log = [];
      this.loadSeen();
      setInterval(() => this.tick(), 100);
    }

    /* ======================= Utilitaires ========================== */
    get auto() { return this.settings.mode !== 'irl'; }
    get irl() { return this.settings.mode === 'irl'; }
    changed() { this.seq++; this.hooks.changed(); }
    fx(name, data) { this.hooks.fx(name, data || {}); }
    say(key, vars, expr) {
      const text = PQA.line(key, vars);
      if (text) this.hooks.say(text, expr || 'neutral');
      return text;
    }
    playerList() { return this.order.map((id) => this.players[id]).filter(Boolean); }
    activePlayers() { return this.playerList().filter((p) => !p.spectator); }
    connectedPlayers() { return this.activePlayers().filter((p) => p.connected || p.local); }
    name(pid) { return this.players[pid] ? this.players[pid].name : '?'; }

    /** Classement (par score décroissant). */
    ranking() {
      return this.activePlayers().slice().sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    }
    rankOf(p) {
      const r = this.ranking();
      // Ex-aequo : même rang
      const i = r.findIndex((x) => x.score === p.score);
      return i + 1;
    }
    teamScores() {
      const n = this.settings.teams;
      const out = [];
      for (let t = 0; t < n; t++) {
        const members = this.activePlayers().filter((p) => p.team === t);
        out.push({ team: t, name: PQA.TEAM_NAMES[t], color: PQA.PALETTE.team[t], score: members.reduce((s, p) => s + p.score, 0), members: members.map((p) => p.id) });
      }
      return out.sort((a, b) => b.score - a.score);
    }

    /* ---- Jobs et chrono (pausables par le présentateur) ---- */
    after(ms, fn, opts = {}) { this.jobs.push({ at: now() + ms, fn, keep: !!opts.keep }); }
    clearJobs() { this.jobs = this.jobs.filter((j) => j.keep); }
    startTimer(ms, onEnd) {
      this.timer = { start: now(), end: now() + ms, total: ms, onEnd, key: ++this.nextId };
    }
    stopTimer() { this.timer = null; }
    timerLeft() {
      if (!this.timer) return 0;
      if (this.paused) return Math.max(0, this.timer.end - this.pausedAt);
      return Math.max(0, this.timer.end - now());
    }
    togglePause() {
      if (this.paused) {
        const d = now() - this.pausedAt;
        if (this.timer) this.timer.end += d;
        this.jobs.forEach((j) => (j.at += d));
        this.paused = false;
      } else {
        this.paused = true;
        this.pausedAt = now();
      }
      this.changed();
    }
    tick() {
      if (this.paused) return;
      const t = now();
      if (this.timer && t >= this.timer.end) {
        const fn = this.timer.onEnd;
        this.timer = null;
        fn && fn();
        this.changed();
      }
      const due = this.jobs.filter((j) => t >= j.at);
      if (due.length) {
        this.jobs = this.jobs.filter((j) => t < j.at);
        due.forEach((j) => j.fn());
        this.changed();
      }
      // Fin des gels de buzzer : on rafraîchit les vues concernées.
      for (const p of this.playerList()) {
        if (p.frozenUntil && t >= p.frozenUntil) { p.frozenUntil = 0; this.changed(); }
      }
    }

    /* ---- Banque de questions : jamais deux fois la même ---- */
    loadSeen() {
      try { this.seen = new Set(JSON.parse(localStorage.getItem('pqa_seen') || '[]')); } catch (e) { this.seen = new Set(); }
    }
    saveSeen() {
      try { localStorage.setItem('pqa_seen', JSON.stringify(Array.from(this.seen).slice(-5000))); } catch (e) {}
    }
    resetSeen() { this.seen = new Set(); this.saveSeen(); }
    /**
     * Tire une question non utilisée dans la partie, de préférence jamais vue
     * sur cet appareil, la plus proche possible de la difficulté visée.
     */
    pickQuestion({ types, cat, diff, diffMin = 1, diffMax = 10, exclude }) {
      let pool = this.bank.filter((q) => !this.used.has(q.id) && types.includes(q.type) && (!cat || q.categorie === cat) && q.difficulte >= diffMin && q.difficulte <= diffMax && (!exclude || !exclude(q)));
      if (!pool.length && (diffMin > 1 || diffMax < 10)) return this.pickQuestion({ types, cat, diff });
      if (!pool.length) return null;
      const unseen = pool.filter((q) => !this.seen.has(q.id));
      if (unseen.length) pool = unseen;
      if (diff) {
        const best = Math.min(...pool.map((q) => Math.abs(q.difficulte - diff)));
        pool = pool.filter((q) => Math.abs(q.difficulte - diff) <= best + 1);
      }
      const q = pickOne(pool);
      this.used.add(q.id);
      this.seen.add(q.id);
      this.saveSeen();
      return q;
    }
    countAvailable(types, cat) {
      return this.bank.filter((q) => !this.used.has(q.id) && types.includes(q.type) && (!cat || q.categorie === cat)).length;
    }
    catIcon(name) { const c = this.categories.find((c) => c.name === name); return c ? c.icon : '❓'; }

    /* ======================= Joueurs ============================== */
    join({ token, name, avatar }) {
      name = String(name || '').trim().slice(0, 14) || 'Anonyme';
      let p = token && this.playerList().find((x) => x.token === token);
      if (p) {
        p.connected = true;
        if (this.phase === 'lobby') { p.name = this.uniqueName(name, p.id); if (avatar) p.avatar = avatar; }
        this.fx('rejoin', { pid: p.id });
        if (this.phase !== 'lobby') this.say('rejoin', { name: p.name }, 'happy');
        this.changed();
        return { p, rejoined: true };
      }
      if (this.settings.mode === 'duel' && this.activePlayers().length >= 2) return { error: 'Le duel est complet (2 joueurs max).' };
      if (this.activePlayers().length >= 10) return { error: 'La partie est complète (10 joueurs max).' };
      const used = new Set(this.playerList().map((x) => x.colorIdx));
      let colorIdx = 0;
      while (used.has(colorIdx) && colorIdx < 9) colorIdx++;
      const id = 'p' + this.nextId++;
      p = {
        id, token: token || PQA.randomToken(), name: this.uniqueName(name), avatar: avatar || PQA.randomAvatar(),
        colorIdx, color: PQA.PALETTE.player[colorIdx], team: 0, score: 0, connected: true, joinedAt: Date.now(),
        streak: 0, bestStreak: 0, cards: [], frozenUntil: 0, mirror: false, mirrorQ: null, double: false, stolenBy: null,
        rtt: 120, local: false, spectator: this.phase !== 'lobby' && false,
        stats: { correct: 0, wrong: 0, answered: 0, buzzWins: 0, wrongBuzz: 0, fastest: null, fourchette: 0, cardsUsed: 0, hardCorrect: 0, worstRank: 1, ladder: 0, ladderStop: false, points: 0 },
        fxSeq: 0,
      };
      this.players[id] = p;
      this.order.push(id);
      if (this.settings.teams) this.autoTeam(p);
      this.fx('join', { pid: id });
      this.say('join', { name: p.name }, 'happy');
      this.changed();
      return { p, rejoined: false };
    }
    uniqueName(name, selfId) {
      let n = name, i = 2;
      while (this.playerList().some((x) => x.id !== selfId && x.name.toLowerCase() === n.toLowerCase())) n = name.slice(0, 12) + i++;
      return n;
    }
    addLocalPlayers() {
      // Duel sur un seul écran : deux joueurs "locaux" (touches A et L).
      ['Joueur A', 'Joueur L'].forEach((nm, i) => {
        if (this.activePlayers().length >= 2) return;
        const { p } = this.join({ name: nm, avatar: PQA.randomAvatar() });
        if (p) { p.local = true; p.key = i === 0 ? 'a' : 'l'; }
      });
      this.changed();
    }
    setConnected(pid, on) {
      const p = this.players[pid];
      if (!p || p.local) return;
      p.connected = on;
      this.changed();
    }
    updateProfile(pid, { name, avatar }) {
      const p = this.players[pid];
      if (!p) return;
      if (name) p.name = this.uniqueName(String(name).trim().slice(0, 14), pid);
      if (avatar) p.avatar = avatar;
      this.changed();
    }
    kick(pid) {
      delete this.players[pid];
      this.order = this.order.filter((x) => x !== pid);
      this.changed();
    }
    autoTeam(p) {
      const n = this.settings.teams;
      const counts = new Array(n).fill(0);
      this.activePlayers().forEach((x) => x !== p && x.team < n && counts[x.team]++);
      p.team = counts.indexOf(Math.min(...counts));
    }
    setTeams(n) {
      this.settings.teams = n;
      this.activePlayers().forEach((p, i) => (p.team = n ? i % n : 0));
      this.changed();
    }
    cycleTeam(pid) {
      const p = this.players[pid];
      if (!p || !this.settings.teams) return;
      p.team = (p.team + 1) % this.settings.teams;
      this.changed();
    }
    shuffleTeams() {
      const n = this.settings.teams;
      if (!n) return;
      PQA.shuffle(this.activePlayers()).forEach((p, i) => (p.team = i % n));
      this.changed();
    }
    /** Ordre de passage : alterne les équipes si besoin. */
    turnOrder() {
      let list = this.connectedPlayers();
      if (!list.length) list = this.activePlayers();
      if (this.settings.teams) {
        const byTeam = [];
        list.forEach((p) => (byTeam[p.team] = byTeam[p.team] || []).push(p));
        const out = [];
        for (let i = 0; out.length < list.length; i++) byTeam.forEach((t) => t && t[i] && out.push(t[i]));
        return out.map((p) => p.id);
      }
      return list.map((p) => p.id);
    }

    /* ======================= Points ============================== */
    multiplier(p) { return p.streak >= 5 ? 3 : p.streak >= 3 ? 2 : 1; }

    /** Bonne réponse : série, multiplicateur, cartes Double et Vol. Renvoie les points marqués. */
    scoreCorrect(p, base, opts = {}) {
      p.streak++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.stats.correct++;
      if (opts.diff >= 8) p.stats.hardCorrect++;
      let pts = base;
      const mult = opts.noCombo ? 1 : this.multiplier(p);
      pts *= mult;
      if (p.double && pts > 0) { pts *= 2; p.double = false; this.fx('pop', { pid: p.id, text: 'DOUBLE !' }); }
      pts = Math.round(pts);
      let receiver = p;
      if (p.stolenBy && this.players[p.stolenBy] && pts > 0) {
        receiver = this.players[p.stolenBy];
        p.stolenBy = null;
        this.fx('pop', { pid: p.id, text: 'VOLÉ par ' + receiver.name + ' !' });
      }
      receiver.score += pts;
      receiver.stats.points += pts;
      if (!opts.silentStreak) {
        if (p.streak === 3) { this.fx('streak', { pid: p.id, mult: 2 }); this.say('streak3', { name: p.name }, 'surprised'); }
        if (p.streak === 5) { this.fx('streak', { pid: p.id, mult: 3 }); this.say('streak5', { name: p.name, n: p.streak }, 'surprised'); }
      }
      this.maybeGiveCard(p);
      this.fx('points', { pid: receiver.id, pts });
      return { pts, mult, receiver: receiver.id };
    }
    scoreWrong(p) {
      p.streak = 0;
      p.stats.wrong++;
    }
    addPoints(pid, delta) {
      const p = this.players[pid];
      if (!p) return;
      p.score += delta;
      this.fx('points', { pid, pts: delta });
      this.changed();
    }
    maybeGiveCard(p) {
      if (!this.settings.cards || this.settings.mode === 'duel' || p.cards.length >= 2) return;
      if (p.streak === 3 || p.streak === 6 || Math.random() < 0.1) {
        const card = pickOne(Object.keys(PQA.CARDS));
        p.cards.push(card);
        this.fx('cardGain', { pid: p.id, card });
        this.hooks.send(p.id, { t: 'fx', fx: 'card', card });
      }
    }
    useCard(pid, card, targetId) {
      const p = this.players[pid];
      if (!p || this.phase === 'lobby' || this.phase === 'end') return;
      const i = p.cards.indexOf(card);
      if (i < 0) return;
      const def = PQA.CARDS[card];
      const target = this.players[targetId];
      if (def.target && (!target || target.id === pid)) return;
      p.cards.splice(i, 1);
      p.stats.cardsUsed++;
      if (card === 'gel') {
        target.frozenUntil = now() + 5000;
        this.hooks.send(target.id, { t: 'fx', fx: 'frozen' });
      } else if (card === 'inverse') {
        target.mirror = true;
      } else if (card === 'vol') {
        target.stolenBy = pid;
      } else if (card === 'double') {
        p.double = true;
      }
      this.fx('card', { pid, target: targetId, card });
      this.say('card_' + card, { name: p.name, target: target ? target.name : '' }, 'smug');
      this.changed();
    }
    isFrozen(p) { return p.frozenUntil && now() < p.frozenUntil; }

    /* ======================= Déroulé ============================== */
    start() {
      if (this.settings.mode === 'duel') {
        if (this.activePlayers().length < 2) return 'Il faut 2 joueurs pour un duel.';
        this.rounds = ['duel'];
      } else {
        if (this.activePlayers().length < 1) return 'Il faut au moins 1 joueur.';
        this.rounds = ROUND_ORDER.filter((r) => this.settings.rounds.includes(r));
        if (!this.rounds.length) return 'Choisis au moins une manche.';
      }
      if (this.settings.teams) this.activePlayers().forEach((p) => p.team >= this.settings.teams && this.autoTeam(p));
      this.activePlayers().forEach((p) => { p.score = 0; p.streak = 0; p.cards = []; });
      this.roundIdx = -1;
      this.fx('start');
      this.say('start', {}, 'happy');
      this.nextRound();
      return null;
    }

    nextRound() {
      this.clearJobs();
      this.stopTimer();
      this.q = null;
      this.roundIdx++;
      if (this.roundIdx >= this.rounds.length) return this.endGame();
      const type = this.rounds[this.roundIdx];
      this.round = { type, n: 0 };
      this.phase = 'intro';
      const leader = this.ranking()[0];
      this.fx('roundIntro', { type });
      this.say('round_' + type, { name: leader ? leader.name : '' }, 'happy');
      if (this.auto) this.after(6000, () => this.beginRound());
      this.changed();
    }

    beginRound() {
      if (this.phase !== 'intro') return;
      this.clearJobs();
      const t = this.round.type;
      const L = LENGTH[this.settings.length];
      if (t === 'eclair' || t === 'fourchette' || t === 'indices') { this.round.total = L[t]; this.nextSimple(); }
      else if (t === 'mystere') { this.round.turns = []; for (let i = 0; i < L.mystereTurns; i++) this.round.turns.push(...this.turnOrder()); this.round.total = this.round.turns.length; this.mystereNext(); }
      else if (t === 'table') this.tableStart(L.table);
      else if (t === 'quatre') this.quatreStart(L.quatre);
      else if (t === 'echelle') this.ladderStart();
      else if (t === 'duel') this.duelStart();
      this.changed();
    }

    /** Fin d'une manche : classement intermédiaire (ou fin de partie). */
    endRound() {
      this.clearJobs();
      this.stopTimer();
      this.q = null;
      if (this.roundIdx >= this.rounds.length - 1) return this.endGame();
      this.phase = 'leaderboard';
      this.updateRankStats();
      const r = this.ranking();
      this.say(pickOne(['leaderboard', 'leader', 'teaseLast']), { first: r[0] && r[0].name, last: r[r.length - 1] && r[r.length - 1].name }, 'smug');
      this.fx('leaderboard');
      if (this.auto) this.after(9000, () => this.nextRound());
      this.changed();
    }

    updateRankStats(silent) {
      const r = this.ranking();
      r.forEach((p, i) => {
        p.prevRank = p.curRank || i + 1;
        p.curRank = i + 1;
        p.stats.worstRank = Math.max(p.stats.worstRank, i + 1);
        if (!silent && p.prevRank - p.curRank >= 2) this.after(1500, () => this.say('comeback', { name: p.name }, 'surprised'));
      });
    }

    /** "Suivant" : bouton du présentateur, de l'écran plateau ou job automatique. */
    advance() {
      switch (this.phase) {
        case 'intro': return this.beginRound();
        case 'reveal': return this.afterReveal();
        case 'leaderboard': return this.nextRound();
        case 'question': return this.forceReveal();
        case 'ladder': return this.ladderQuestion();
        case 'cell': return this.tableAfterCell();
        case 'qresult': return this.quatreNextPlayer();
        case 'ko': return this.endGame();
        case 'wheel': return this.mystereLevel();
        default: return;
      }
    }
    forceReveal() {
      if (this.phase !== 'question' || !this.q) return;
      if (this.q.kind === 'ladder') return this.ladderReveal();
      if (this.q.kind === 'quatre') return this.quatreEnd();
      this.reveal();
    }

    /* ======================= Questions ============================ */
    /**
     * Prépare une question. kind :
     *  'all'    : tout le monde répond (QCM éclair, Fourchette)
     *  'single' : un seul joueur répond (Thème Mystère, Table, 4 à la suite)
     *  'buzz'   : premier qui buzze (Indices, Duel)
     *  'ladder' : le ou les finalistes (Échelle)
     */
    makeQ(data, kind, answerers, extra = {}) {
      const q = { data, kind, answerers, answers: {}, results: {}, startedAt: now(), id: ++this.nextId, ...extra };
      if (data.type === 'qcm') {
        q.choices = PQA.shuffle(data.choix);
        q.correctIdx = q.choices.indexOf(data.reponse);
      } else if (data.type === 'vf') {
        q.choices = ['Vrai', 'Faux'];
        q.correctIdx = data.reponse === 'Vrai' ? 0 : 1;
      }
      // Effet "Miroir" : appliqué à la prochaine question de la cible.
      this.playerList().forEach((p) => {
        p.mirrorQ = null;
        if (p.mirror && answerers.includes(p.id) && q.choices) { p.mirror = false; p.mirrorQ = q.id; p.mirrorOrder = PQA.shuffle(q.choices.map((_, i) => i)); }
      });
      this.q = q;
      this.phase = 'question';
      return q;
    }

    evaluate(q, value) {
      const d = q.data;
      if (d.type === 'qcm' || d.type === 'vf') return Number(value) === q.correctIdx;
      if (d.type === 'libre' || d.type === 'indices') return PQA.matchAnswer(value, d);
      return false;
    }

    /** Réception d'une réponse d'un joueur. */
    answer(pid, value) {
      const q = this.q, p = this.players[pid];
      if (!q || !p || this.phase !== 'question') return;
      if (this.isFrozen(p)) return this.hooks.send(pid, { t: 'fx', fx: 'frozen' });
      if (q.kind === 'buzz') return this.buzzAnswer(pid, value);
      if (q.kind === 'ladder') return this.ladderAnswer(pid, value);
      if (q.kind === 'quatre') return this.quatreAnswer(pid, value);
      if (!q.answerers.includes(pid) || q.answers[pid]) return;
      const t = now() - q.startedAt;
      if (q.data.type === 'fourchette') {
        // Une seule valeur : il faut viser pile (ancien format {min, max} d'un téléphone pas à jour : on prend le milieu).
        const x = value && typeof value === 'object' ? (Number(value.min) + Number(value.max)) / 2 : Number(value);
        if (!isFinite(x)) return;
        q.answers[pid] = { value: x, t };
      } else {
        q.answers[pid] = { value, t, text: typeof value === 'string' ? value.slice(0, 60) : undefined };
      }
      p.stats.answered++;
      this.fx('lock', { pid });
      if (q.kind === 'single') {
        // Réponse libre en mode présentateur IRL : c'est lui qui valide.
        if (this.irl && (q.data.type === 'libre')) { q.pending = { pid, text: q.answers[pid].text }; this.changed(); return; }
        this.reveal();
        return;
      }
      if (q.answerers.every((id) => q.answers[id] || !(this.players[id] && (this.players[id].connected || this.players[id].local)))) {
        this.clearJobs();
        this.after(700, () => this.phase === 'question' && this.q === q && this.reveal());
      }
      this.changed();
    }

    /** Validation par le présentateur IRL (réponse orale / libre). */
    validate(ok) {
      const q = this.q;
      if (!q || this.phase !== 'question') return;
      if (q.kind === 'buzz' && q.buzz.current) return this.resolveBuzz(q.buzz.current, ok);
      if (q.kind === 'single') {
        const pid = q.answerers[0];
        q.answers[pid] = q.answers[pid] || { value: '(oral)', t: now() - q.startedAt, text: '(à l’oral)' };
        q.forced = { [pid]: ok };
        q.pending = null;
        this.reveal();
      }
    }

    /** Révélation de la bonne réponse et calcul des points. */
    reveal() {
      const q = this.q;
      if (!q || q.revealed) return;
      q.revealed = true;
      this.clearJobs();
      this.stopTimer();
      const d = q.data;
      const type = this.round.type;
      const res = q.results;
      if (d.type === 'fourchette') this.scoreFourchette(q);
      else if (q.kind === 'all' || q.kind === 'single') {
        for (const pid of q.answerers) {
          const p = this.players[pid];
          if (!p) continue;
          const a = q.answers[pid];
          if (!a) { if (q.kind === 'single') this.scoreWrong(p); res[pid] = { correct: false, pts: 0, none: true }; continue; }
          const ok = q.forced && pid in q.forced ? q.forced[pid] : this.evaluate(q, a.value);
          if (ok) {
            let base = 0;
            if (type === 'eclair') base = 100 + Math.round(100 * Math.max(0, 1 - a.t / q.duration));
            else if (type === 'mystere') base = this.round.level * 20;
            else if (type === 'table') base = this.round.cellValue;
            if (type === 'table' && this.round.cell.special === 'vol' && this.round.victim) {
              const v = this.players[this.round.victim];
              const stolen = Math.min(base, Math.max(0, v ? v.score : 0));
              if (v) { v.score -= stolen; this.fx('points', { pid: v.id, pts: -stolen }); }
              p.streak++; p.stats.correct++;
              p.score += stolen; this.fx('points', { pid, pts: stolen });
              res[pid] = { correct: true, pts: stolen, stolen: true };
            } else {
              const r = this.scoreCorrect(p, base, { diff: d.difficulte });
              res[pid] = { correct: true, pts: r.pts, mult: r.mult };
            }
          } else {
            this.scoreWrong(p);
            res[pid] = { correct: false, pts: 0 };
          }
        }
      }
      // Statistiques de réponses (pourcentages par choix)
      if (q.choices) {
        q.dist = q.choices.map(() => 0);
        Object.values(q.answers).forEach((a) => { if (q.dist[a.value] != null) q.dist[a.value]++; });
      }
      this.phase = 'reveal';
      const winners = Object.keys(res).filter((pid) => res[pid].correct);
      this.fx('reveal', { winners, losers: Object.keys(res).filter((pid) => !res[pid].correct && !res[pid].none) });
      winners.forEach((pid) => this.hooks.send(pid, { t: 'fx', fx: 'good' }));
      Object.keys(res).filter((pid) => !res[pid].correct && !res[pid].none).forEach((pid) => this.hooks.send(pid, { t: 'fx', fx: 'wrong' }));
      this.commentReveal(q, winners);
      if (this.auto) this.after(this.revealDelay(q), () => this.afterReveal());
      this.changed();
    }

    commentReveal(q, winners) {
      const vars = { text: q.data.anecdote };
      if (q.data.type === 'fourchette') {
        const w = Object.keys(q.results).find((pid) => q.results[pid].rank === 1 && q.results[pid].correct);
        if (w) this.say(q.results[w].exact ? 'fourchettePile' : 'fourchetteWin', { name: this.name(w) }, 'happy');
        else this.say('fourchetteNone', {}, 'sad');
      } else if (q.kind === 'single') {
        const pid = q.answerers[0];
        if (winners.length) this.say('correct', { name: this.name(pid), pts: q.results[pid].pts }, 'happy');
        else this.say(q.answers[pid] ? 'wrong' : 'timeout', { name: this.name(pid) }, 'sad');
      } else if (q.kind === 'buzz') {
        // déjà commenté pendant le buzz
      } else if (winners.length === 0) this.say('correctNone', {}, 'sad');
      else if (winners.length === 1) this.say('correct', { name: this.name(winners[0]), pts: q.results[winners[0]].pts }, 'happy');
      else this.say('correctMany', { n: winners.length }, 'happy');
      // L'anecdote "Le saviez-vous ?" arrive juste après.
      if (q.data.anecdote) this.after(2600, () => this.say('anecdote', vars, 'wink'), { keep: false });
    }
    revealDelay(q) {
      const len = (q.data.anecdote || '').length;
      return clamp(7000 + len * 45, 8000, 15000) + (q.data.type === 'fourchette' ? 3500 : 0);
    }

    afterReveal() {
      if (this.phase !== 'reveal') return;
      this.clearJobs();
      this.playerList().forEach((p) => (p.mirrorQ = null));
      const t = this.round.type;
      if (t === 'mystere') return this.mystereNext();
      if (t === 'table') return this.tableNextTurn();
      if (t === 'echelle') return this.ladderAfterReveal();
      if (t === 'duel') return this.duelNext();
      this.nextSimple();
    }

    /* ---- Manches "simples" : QCM éclair, Fourchette, Indices ---- */
    nextSimple() {
      const r = this.round;
      if (r.n >= r.total) return this.endRound();
      const types = r.type === 'eclair' ? ['qcm', 'vf'] : r.type === 'fourchette' ? ['fourchette'] : ['indices'];
      // Difficulté qui monte doucement au fil de la manche.
      const diff = clamp(Math.round(3 + (r.n / Math.max(1, r.total - 1)) * 6 + (Math.random() * 2 - 1)), 2, 10);
      const data = this.pickQuestion({ types, diff });
      if (!data) return this.endRound();
      r.n++;
      const everyone = this.activePlayers().map((p) => p.id);
      if (r.type === 'indices') return this.startIndices(data, everyone);
      const q = this.makeQ(data, 'all', everyone);
      q.duration = r.type === 'eclair' ? TIMES.eclair + Math.min(8000, data.question.length * 40) : TIMES.fourchette;
      this.startTimer(q.duration, () => this.reveal());
      this.fx('question');
      if (data.difficulte >= 8) this.say('hardQuestion', {}, 'surprised');
      else if (data.difficulte <= 2) this.say('easyQuestion', {}, 'smug');
      else this.say('question', {}, 'neutral');
      this.changed();
    }

    /**
     * Fourchette : chacun donne UNE valeur et doit viser pile.
     *  - pile (écart ≤ tolérance, plafonnée à 2 % de la réponse) : 400 pts
     *  - sinon 300 × exp(-écart / échelle) :
     *      dates : écart rapporté à l'amplitude des bornes, échelle 5 %
     *      quantités : plus petit écart relatif (à la réponse ou aux bornes), échelle 10 %
     *  - le plus proche touche +50 ; moins de 30 pts = raté
     */
    fourchetteGap(d, x) {
      const [lo, hi] = d.bornes || [0, 0];
      const gap = Math.abs(x - d.reponse);
      const span = hi - lo || Math.abs(d.reponse) || 1;
      if (d.unite === 'année') return gap / span / 0.05;
      return Math.min(d.reponse ? gap / Math.abs(d.reponse) : Infinity, gap / span) / 0.1;
    }
    scoreFourchette(q) {
      const d = q.data;
      const tol = Math.min(d.tolerance || 0, Math.abs(d.reponse) * 0.02);
      const scored = [];
      for (const pid of q.answerers) {
        const p = this.players[pid];
        const a = q.answers[pid];
        if (!p) continue;
        if (!a) { q.results[pid] = { correct: false, pts: 0, none: true }; continue; }
        const diff = Math.abs(a.value - d.reponse);
        const exact = diff <= tol;
        const base = exact ? 400 : Math.round(300 * Math.exp(-this.fourchetteGap(d, a.value)));
        scored.push({ pid, diff, exact, base });
      }
      scored.sort((a, b) => a.diff - b.diff);
      const best = scored.length ? scored[0].diff : null;
      scored.forEach((it) => {
        const p = this.players[it.pid];
        const rank = scored.findIndex((x) => x.diff === it.diff) + 1;
        let base = it.base;
        if (base < 30) { this.scoreWrong(p); q.results[it.pid] = { correct: false, pts: 0, rank, gap: it.diff }; return; }
        if (it.diff === best) { base += 50; p.stats.fourchette++; }
        const r = this.scoreCorrect(p, base, { diff: d.difficulte });
        q.results[it.pid] = { correct: true, pts: r.pts, rank, exact: it.exact, gap: it.diff, mult: r.mult };
      });
      this.fx('drumroll');
    }

    /* ---- Buzzer (Indices et Duel) ---- */
    startIndices(data, everyone) {
      const q = this.makeQ(data, 'buzz', everyone);
      q.clue = 0;
      q.buzz = { open: true, locked: [], current: null, pending: [], readyAt: now() + readTime(data.question + ' ' + data.indices[0]) };
      this.after(q.buzz.readyAt - now(), () => this.changed());
      this.fx('question');
      this.say('question', {}, 'neutral');
      this.scheduleClue(q);
      this.changed();
    }
    scheduleClue(q) {
      const last = q.clue >= q.data.indices.length - 1;
      if (last) this.startTimer(TIMES.afterLastClue, () => this.buzzTimeout());
      else this.startTimer(TIMES.clue, () => this.nextClue());
    }
    nextClue() {
      const q = this.q;
      if (!q || q.kind !== 'buzz' || q.revealed || !q.data.indices) return;
      if (q.buzz.current) return;
      if (q.clue < q.data.indices.length - 1) { q.clue++; this.fx('clue'); }
      this.scheduleClue(q);
      this.changed();
    }
    buzzTimeout() {
      if (this.q && !this.q.revealed) { this.say('timeout', {}, 'sad'); this.reveal(); }
    }
    /** Réception d'un buzz. Le gagnant est choisi après une courte fenêtre de collecte. */
    buzz(pid) {
      const q = this.q, p = this.players[pid];
      if (!q || !p || q.kind !== 'buzz' || this.phase !== 'question' || q.revealed) return;
      if (!q.buzz.open || q.buzz.locked.includes(pid) || !q.answerers.includes(pid)) return;
      if (this.isFrozen(p)) return this.hooks.send(pid, { t: 'fx', fx: 'frozen' });
      if (p.buzzBlockedUntil && now() < p.buzzBlockedUntil) return;
      // Faux départ : buzz avant la fin de la lecture de la question.
      if (q.buzz.readyAt && now() < q.buzz.readyAt) {
        p.buzzBlockedUntil = now() + BUZZ.falseStart;
        this.after(BUZZ.falseStart, () => this.changed());
        this.fx('pop', { pid, text: '⛔ Faux départ !' });
        this.fx('falsestart', { pid });
        this.hooks.send(pid, { t: 'fx', fx: 'falsestart' });
        this.changed();
        return;
      }
      if (q.buzz.pending.some((b) => b.pid === pid)) return;
      // Compensation de latence : on retranche la moitié du ping mesuré (plafonnée).
      const arrival = now();
      const eff = arrival - (p.local ? 0 : Math.min(p.rtt / 2, 250));
      q.buzz.pending.push({ pid, eff, arrival });
      if (q.buzz.pending.length === 1) this.after(140, () => this.decideBuzz(q), { keep: true });
    }
    decideBuzz(q) {
      if (this.q !== q || !q.buzz.open || !q.buzz.pending.length) return;
      q.buzz.pending.sort((a, b) => a.eff - b.eff);
      const win = q.buzz.pending[0];
      q.buzz.pending = [];
      q.buzz.open = false;
      q.buzz.current = win.pid;
      const p = this.players[win.pid];
      const reaction = win.eff - q.startedAt;
      p.stats.buzzWins++;
      if (p.stats.fastest == null || reaction < p.stats.fastest) p.stats.fastest = reaction;
      // Le chrono de la question est mis en pause pendant que le joueur répond.
      q.savedTimer = this.timer ? { left: this.timerLeft(), onEnd: this.timer.onEnd, total: this.timer.total } : null;
      // Réponse orale en mode IRL : le présentateur garde la main sur le temps.
      const dur = this.irl && q.data.type === 'indices' ? TIMES.buzzAnswerIRL : q.data.type === 'indices' ? BUZZ.answerText : BUZZ.answer;
      this.startTimer(dur, () => this.resolveBuzz(win.pid, false, true));
      this.fx('buzz', { pid: win.pid });
      this.hooks.send(win.pid, { t: 'fx', fx: 'buzzwin' });
      this.say('firstBuzz', { name: p.name }, 'surprised');
      this.changed();
    }
    buzzAnswer(pid, value) {
      const q = this.q;
      if (q.buzz.current !== pid || q.buzzAnswered) return;
      const p = this.players[pid];
      p.stats.answered++;
      q.answers[pid] = { value, t: now() - q.startedAt, text: typeof value === 'string' ? value.slice(0, 60) : undefined };
      if (this.irl && q.data.type === 'indices') { q.pending = { pid, text: q.answers[pid].text }; this.changed(); return; }
      this.resolveBuzz(pid, this.evaluate(q, value));
    }
    resolveBuzz(pid, ok, timeout) {
      const q = this.q;
      if (!q || q.buzz.current !== pid || q.revealed) return;
      const p = this.players[pid];
      q.pending = null;
      q.buzz.current = null;
      if (ok) {
        if (this.round.type === 'duel') return this.duelHit(pid);
        const n = q.data.indices.length;
        const base = Math.round((300 * (n - q.clue)) / n / 10) * 10;
        const r = this.scoreCorrect(p, base, { diff: q.data.difficulte });
        q.results[pid] = { correct: true, pts: r.pts, mult: r.mult, clue: q.clue + 1 };
        this.say('correct', { name: p.name, pts: r.pts }, 'happy');
        return this.reveal();
      }
      // Erreur : pénalité, joueur bloqué, le buzzer se rouvre pour les autres.
      this.scoreWrong(p);
      p.stats.wrongBuzz++;
      q.buzz.locked.push(pid);
      let pts = -BUZZ.penalty;
      if (this.round.type === 'duel') {
        pts = -BUZZ.duelPenalty;
        this.round.hp[pid] = Math.max(0, this.round.hp[pid] - BUZZ.duelPenalty);
      } else {
        p.score -= BUZZ.penalty;
      }
      this.fx('points', { pid, pts });
      q.results[pid] = { correct: false, pts, wrongAnswer: q.answers[pid] && q.answers[pid].text, timeout: !!timeout };
      delete q.answers[pid];
      this.fx('wrong', { pid });
      this.hooks.send(pid, { t: 'fx', fx: 'wrong' });
      this.say(timeout ? 'timeout' : 'wrong', { name: p.name }, 'sad');
      const remaining = q.answerers.filter((id) => !q.buzz.locked.includes(id) && this.players[id] && (this.players[id].connected || this.players[id].local));
      if (!remaining.length) { this.after(1200, () => this.reveal()); this.changed(); return; }
      q.buzz.open = true;
      if (q.savedTimer) {
        const s = q.savedTimer;
        this.startTimer(Math.max(s.left, 4000), s.onEnd);
        this.timer.total = s.total;
      }
      this.changed();
    }

    /* ---- Thème Mystère ---- */
    mystereNext() {
      const r = this.round;
      if (r.n >= r.total) return this.endRound();
      const pid = r.turns[r.n];
      r.n++;
      if (!this.players[pid]) return this.mystereNext();
      r.player = pid;
      // La roue : 8 catégories qui ont encore des questions, dont la cible.
      const types = ['qcm', 'vf', 'libre'];
      const cats = PQA.shuffle(this.categories.map((c) => c.name).filter((c) => this.countAvailable(types, c) > 0));
      if (!cats.length) return this.endRound();
      const slots = cats.slice(0, 8);
      while (slots.length < 8) slots.push(slots[slots.length % Math.max(1, cats.length)]);
      const target = rand(slots.length);
      r.wheel = { slots: slots.map((c) => ({ name: c, icon: this.catIcon(c) })), target, start: Date.now(), spin: 4200 };
      r.cat = slots[target];
      r.level = null;
      this.phase = 'wheel';
      this.q = null;
      this.fx('wheel', { duration: r.wheel.spin });
      this.say('wheel', {}, 'neutral');
      this.after(r.wheel.spin + 900, () => this.mystereLevel());
      this.changed();
    }
    mystereLevel() {
      if (this.phase !== 'wheel') return;
      this.clearJobs();
      const r = this.round;
      this.phase = 'level';
      this.say('wheelResult', { cat: r.cat, name: this.name(r.player) }, 'smug');
      this.startTimer(TIMES.level, () => this.chooseLevel(r.player, 5));
      this.changed();
    }
    chooseLevel(pid, level) {
      const r = this.round;
      if (this.phase !== 'level' || pid !== r.player) return;
      r.level = clamp(Math.round(Number(level) || 5), 1, 10);
      this.stopTimer();
      this.fx('select');
      this.say(r.level >= 7 ? 'levelHigh' : 'levelLow', { level: r.level, name: this.name(pid) }, r.level >= 7 ? 'surprised' : 'smug');
      const data = this.pickQuestion({ types: ['qcm', 'vf', 'libre'], cat: r.cat, diff: r.level });
      if (!data) return this.mystereNext();
      this.after(1800, () => {
        const q = this.makeQ(data, 'single', [pid]);
        q.duration = data.type === 'libre' ? TIMES.singleLibre : TIMES.single;
        this.startTimer(q.duration, () => this.reveal());
        this.fx('question');
      });
      this.changed();
    }

    /* ---- Table des Savoirs ---- */
    tableStart([cols, rows]) {
      const types = ['qcm', 'vf', 'libre'];
      const cats = PQA.shuffle(this.categories.map((c) => c.name).filter((c) => this.countAvailable(types, c) >= rows)).slice(0, cols);
      const cells = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cats.length; x++) {
        cells.push({ i: cells.length, x, y, cat: cats[x], icon: this.catIcon(cats[x]), value: (y + 1) * 100 + (Math.random() < 0.3 ? 100 : 0), special: null, used: false });
      }
      // Cases spéciales cachées
      const n = cells.length;
      const specials = PQA.shuffle(['piege', 'double', 'vol', ...(n >= 12 ? ['piege', 'double', 'vol'] : [])]);
      PQA.shuffle(cells).slice(0, specials.length).forEach((c, i) => (c.special = specials[i]));
      const r = this.round;
      r.cells = cells; r.cols = cats.length; r.rows = rows;
      r.turns = this.turnOrder();
      r.turn = 0;
      r.total = n;
      this.tableBoard();
    }
    tableBoard() {
      const r = this.round;
      if (r.cells.every((c) => c.used)) return this.endRound();
      r.player = r.turns[r.turn % r.turns.length];
      r.turn++;
      if (!this.players[r.player]) return this.tableBoard();
      r.cell = null; r.victim = null;
      this.q = null;
      this.phase = 'board';
      this.say('tablePick', { name: this.name(r.player) }, 'neutral');
      this.startTimer(TIMES.board, () => {
        const free = r.cells.filter((c) => !c.used);
        this.tablePick(r.player, pickOne(free).i);
      });
      this.changed();
    }
    tablePick(pid, idx) {
      const r = this.round;
      if (this.phase !== 'board' || pid !== r.player) return;
      const cell = r.cells[idx];
      if (!cell || cell.used) return;
      cell.used = true;
      r.cell = cell;
      r.n++;
      this.stopTimer();
      this.phase = 'cell';
      r.cellValue = cell.special === 'double' ? cell.value * 2 : cell.value;
      const p = this.players[pid];
      if (cell.special === 'piege') {
        const loss = Math.min(cell.value, Math.max(0, p.score));
        p.score -= loss;
        r.trapLoss = loss;
        this.fx('trap', { pid });
        this.fx('points', { pid, pts: -loss });
        this.say('trap', { name: p.name, pts: loss }, 'smug');
        if (this.auto) this.after(5000, () => this.tableNextTurn());
      } else {
        this.fx(cell.special === 'double' ? 'double' : cell.special === 'vol' ? 'steal' : 'select', { pid });
        if (cell.special === 'double') this.say('double', { name: p.name, pts: r.cellValue }, 'surprised');
        if (cell.special === 'vol') this.say('steal', { name: p.name }, 'smug');
        this.after(2600, () => this.tableAfterCell());
      }
      this.changed();
    }
    tableAfterCell() {
      const r = this.round;
      if (this.phase !== 'cell') return;
      this.clearJobs();
      if (r.cell.special === 'piege') return this.tableNextTurn();
      if (r.cell.special === 'vol' && !r.victim) {
        const others = this.activePlayers().filter((p) => p.id !== r.player);
        if (others.length) {
          this.phase = 'target';
          this.startTimer(TIMES.target, () => this.tableTarget(r.player, this.ranking().find((p) => p.id !== r.player).id));
          return this.changed();
        }
      }
      this.tableQuestion();
    }
    tableTarget(pid, targetId) {
      const r = this.round;
      if (this.phase !== 'target' || pid !== r.player || !this.players[targetId] || targetId === pid) return;
      r.victim = targetId;
      this.stopTimer();
      this.tableQuestion();
    }
    tableQuestion() {
      const r = this.round;
      const v = r.cell.value;
      const diff = v <= 100 ? 3 : v <= 200 ? 5 : v <= 300 ? 7 : v <= 400 ? 8 : 10;
      const data = this.pickQuestion({ types: ['qcm', 'vf', 'libre'], cat: r.cell.cat, diff });
      if (!data) return this.tableNextTurn();
      const q = this.makeQ(data, 'single', [r.player]);
      q.duration = data.type === 'libre' ? TIMES.singleLibre : TIMES.single;
      this.startTimer(q.duration, () => this.reveal());
      this.fx('question');
      this.changed();
    }
    tableNextTurn() {
      if (this.phase === 'cell' || this.phase === 'reveal') { this.clearJobs(); this.tableBoard(); }
    }

    /* ---- 4 à la suite ---- */
    quatreStart(n) {
      const r = this.round;
      r.queue = this.ranking().filter((p) => p.connected || p.local).slice(0, n).reverse().map((p) => p.id); // du moins bon au meilleur
      if (!r.queue.length) return this.endRound();
      r.total = r.queue.length;
      this.quatreNextPlayer(true);
    }
    quatreNextPlayer(first) {
      const r = this.round;
      if (!first && this.phase !== 'qresult') return;
      this.clearJobs();
      if (!r.queue.length) return this.endRound();
      r.player = r.queue.shift();
      r.n++;
      const types = ['qcm', 'vf'];
      r.themes = PQA.shuffle(this.categories.map((c) => c.name).filter((c) => this.countAvailable(types, c) >= 8)).slice(0, 4).map((c) => ({ name: c, icon: this.catIcon(c) }));
      r.run = null;
      this.q = null;
      this.phase = 'qpick';
      this.startTimer(TIMES.target, () => this.quatreTheme(r.player, rand(r.themes.length)));
      this.changed();
    }
    quatreTheme(pid, idx) {
      const r = this.round;
      if (this.phase !== 'qpick' || pid !== r.player || !r.themes[idx]) return;
      r.cat = r.themes[idx].name;
      r.run = { streak: 0, best: 0, correct: 0, done: false, last: null };
      this.stopTimer();
      this.fx('select');
      this.phase = 'question';
      this.startTimer(TIMES.quatre, () => this.quatreEnd());
      this.quatreQuestion();
    }
    quatreQuestion() {
      const r = this.round;
      const data = this.pickQuestion({ types: ['qcm', 'vf'], cat: r.cat, diffMin: 2, diffMax: 8, diff: 4 + r.run.streak })
        || this.pickQuestion({ types: ['qcm', 'vf'], diffMax: 8, diff: 5 });
      if (!data) return this.quatreEnd();
      const keepTimer = this.timer;
      const q = this.makeQ(data, 'quatre', [r.player]);
      this.timer = keepTimer;
      q.startedAt = now();
      this.changed();
    }
    quatreAnswer(pid, value) {
      const r = this.round, q = this.q;
      if (pid !== r.player || !r.run || r.run.done || q.answers[pid]) return;
      q.answers[pid] = { value };
      const ok = this.evaluate(q, value);
      const p = this.players[pid];
      if (ok) {
        r.run.streak++; r.run.correct++;
        r.run.best = Math.max(r.run.best, r.run.streak);
        const res = this.scoreCorrect(p, 50, { diff: q.data.difficulte, noCombo: true, silentStreak: true });
        this.fx('correct', { pid, pts: res.pts });
        this.hooks.send(pid, { t: 'fx', fx: 'good' });
      } else {
        r.run.streak = 0;
        this.scoreWrong(p);
        this.fx('wrong', { pid });
        this.hooks.send(pid, { t: 'fx', fx: 'wrong' });
      }
      r.run.last = { ok, answer: q.choices[q.correctIdx] };
      if (r.run.streak >= 4) {
        r.run.won = true;
        const bonus = this.scoreCorrect(p, 200, { noCombo: true, silentStreak: true });
        r.run.bonus = bonus.pts;
        this.fx('streak', { pid, mult: 4 });
        return this.quatreEnd();
      }
      this.after(700, () => this.phase === 'question' && this.quatreQuestion());
      this.changed();
    }
    quatreEnd() {
      const r = this.round;
      if (!r.run || r.run.done) return;
      r.run.done = true;
      this.clearJobs();
      this.stopTimer();
      this.phase = 'qresult';
      this.q = null;
      if (r.run.won) this.say('streak5', { name: this.name(r.player), n: 4 }, 'surprised');
      else this.say(r.run.best >= 2 ? 'correct' : 'teaseLast', { name: this.name(r.player), pts: r.run.correct * 50, last: this.name(r.player) }, r.run.best >= 2 ? 'happy' : 'smug');
      if (this.auto) this.after(5000, () => this.quatreNextPlayer());
      this.changed();
    }

    /* ---- Finale : l'Échelle ---- */
    ladderStart() {
      const r = this.round;
      const rk = this.ranking().filter((p) => p.connected || p.local);
      const n = this.settings.finale === 'duo' && rk.length >= 3 ? 2 : 1;
      r.climbers = rk.slice(0, n).map((p) => ({ id: p.id, step: 0, status: 'active', jokers: { fifty: true, public: true, friend: true }, hidden: [], banked: 0 }));
      if (!r.climbers.length) return this.endRound();
      r.total = 10;
      this.phase = 'ladder';
      this.fx('ladder');
      if (this.auto) this.after(4500, () => this.ladderQuestion());
      this.changed();
    }
    activeClimbers() { return this.round.climbers.filter((c) => c.status === 'active'); }
    ladderQuestion() {
      const r = this.round;
      if (this.phase !== 'ladder' && this.phase !== 'reveal') return;
      this.clearJobs();
      const active = this.activeClimbers();
      if (!active.length) return this.ladderFinish();
      const step = Math.max(...active.map((c) => c.step));
      if (step >= 10) return this.ladderFinish();
      const data = this.pickQuestion({ types: ['qcm'], diff: step + 1, diffMin: Math.max(1, step - 1), diffMax: Math.min(10, step + 3) });
      if (!data) return this.ladderFinish();
      active.forEach((c) => { c.hidden = []; c.answer = null; });
      r.vote = null; r.friend = null;
      const q = this.makeQ(data, 'ladder', active.map((c) => c.id));
      q.duration = TIMES.ladder;
      this.startTimer(q.duration, () => this.ladderReveal());
      this.fx('question');
      this.changed();
    }
    climber(pid) { return this.round && this.round.climbers && this.round.climbers.find((c) => c.id === pid); }
    ladderAnswer(pid, value) {
      const c = this.climber(pid);
      const q = this.q;
      if (!c || c.status !== 'active' || c.answer != null || !q.answerers.includes(pid)) return;
      const v = Number(value);
      if (c.hidden.includes(v)) return;
      c.answer = v;
      q.answers[pid] = { value: v };
      this.fx('lock', { pid });
      if (this.activeClimbers().filter((x) => q.answerers.includes(x.id)).every((x) => x.answer != null)) {
        this.clearJobs();
        this.after(400, () => this.ladderReveal());
      }
      this.changed();
    }
    ladderStop(pid) {
      const c = this.climber(pid);
      if (!c || c.status !== 'active' || c.step === 0 || this.phase !== 'question' || c.answer != null) return;
      c.status = 'stopped';
      c.banked = PQA.LADDER[c.step - 1];
      this.players[pid].stats.ladderStop = true;
      this.say('ladderStop', { name: this.name(pid) }, 'smug');
      if (!this.activeClimbers().some((x) => this.q.answerers.includes(x.id) && x.answer == null)) this.ladderReveal();
      this.changed();
    }
    joker(pid, kind, arg) {
      const c = this.climber(pid);
      const q = this.q;
      if (!c || c.status !== 'active' || !q || q.kind !== 'ladder' || this.phase !== 'question' || !c.jokers[kind]) return;
      const r = this.round;
      if (kind === 'fifty') {
        const wrong = PQA.shuffle(q.choices.map((_, i) => i).filter((i) => i !== q.correctIdx));
        c.hidden = wrong.slice(0, 2);
        this.say('joker5050', {}, 'smug');
      } else if (kind === 'public') {
        const voters = this.connectedPlayers().filter((p) => !this.climber(p.id)).map((p) => p.id);
        if (!voters.length) return this.hooks.send(pid, { t: 'toast', text: 'Pas de public disponible !' });
        r.vote = { voters, votes: {}, open: true, end: now() + TIMES.vote };
        this.after(TIMES.vote, () => this.closeVote());
        this.say('jokerPublic', {}, 'happy');
      } else if (kind === 'friend') {
        const friend = this.players[arg];
        if (!friend || this.climber(arg) || !(friend.connected || friend.local)) return;
        r.friend = { id: arg, from: pid, end: now() + TIMES.friend };
        this.after(TIMES.friend, () => { if (r.friend) r.friend.done = true; });
        this.say('jokerFriend', { name: friend.name }, 'happy');
      }
      c.jokers[kind] = false;
      if (this.timer) this.timer.end += kind === 'fifty' ? 0 : 10000; // un peu de temps en plus
      this.fx('joker', { pid, kind });
      this.changed();
    }
    vote(pid, idx) {
      const v = this.round && this.round.vote;
      if (!v || !v.open || !v.voters.includes(pid)) return;
      v.votes[pid] = Number(idx);
      if (v.voters.every((id) => id in v.votes)) this.closeVote();
      this.changed();
    }
    closeVote() {
      const v = this.round && this.round.vote;
      if (!v || !v.open) return;
      v.open = false;
      v.dist = this.q.choices.map(() => 0);
      Object.values(v.votes).forEach((i) => v.dist[i] != null && v.dist[i]++);
      this.fx('pop');
      this.changed();
    }
    ladderReveal() {
      const q = this.q;
      if (!q || q.revealed || q.kind !== 'ladder') return;
      q.revealed = true;
      this.clearJobs();
      this.stopTimer();
      if (this.round.vote && this.round.vote.open) this.closeVote();
      this.phase = 'reveal';
      this.fx('drumroll');
      // Suspense : on attend le roulement de tambour avant de juger.
      this.revealPending = true;
      this.after(2200, () => {
        this.revealPending = false;
        const winners = [];
        for (const c of this.round.climbers) {
          if (!q.answerers.includes(c.id) || c.status !== 'active') continue;
          const p = this.players[c.id];
          if (c.answer === q.correctIdx) {
            c.step++;
            p.stats.correct++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
            p.stats.ladder = Math.max(p.stats.ladder, c.step);
            q.results[c.id] = { correct: true, pts: PQA.LADDER[c.step - 1] };
            winners.push(c.id);
            this.hooks.send(c.id, { t: 'fx', fx: 'good' });
            if (c.step >= 10) { c.status = 'top'; c.banked = PQA.LADDER[9]; }
          } else {
            c.status = 'out';
            c.banked = c.step > PQA.LADDER_SAFE ? PQA.LADDER[PQA.LADDER_SAFE] : 0;
            this.scoreWrong(p);
            q.results[c.id] = { correct: false, pts: 0 };
            this.hooks.send(c.id, { t: 'fx', fx: 'wrong' });
          }
        }
        if (q.choices) { q.dist = q.choices.map(() => 0); Object.values(q.answers).forEach((a) => q.dist[a.value] != null && q.dist[a.value]++); }
        const top = this.round.climbers.find((c) => c.status === 'top');
        this.fx('reveal', { winners, losers: q.answerers.filter((id) => !winners.includes(id)) });
        if (top) this.say('ladderTop', { name: this.name(top.id) }, 'surprised');
        else if (winners.length) {
          const c = this.climber(winners[0]);
          this.say(c.step === PQA.LADDER_SAFE + 1 ? 'ladderSafe' : 'ladderStep', { n: c.step }, 'happy');
        } else if (q.answerers.length) this.say('ladderFail', {}, 'sad');
        if (q.data.anecdote) this.after(2500, () => this.say('anecdote', { text: q.data.anecdote }, 'wink'));
        if (this.auto) this.after(this.revealDelay(q), () => this.afterReveal());
        this.changed();
      });
      this.changed();
    }
    ladderAfterReveal() {
      if (this.activeClimbers().length) return this.ladderQuestion();
      this.ladderFinish();
    }
    ladderFinish() {
      const r = this.round;
      if (r.finished) return;
      r.finished = true;
      for (const c of r.climbers) {
        if (c.status === 'active') { c.status = 'stopped'; c.banked = c.step ? PQA.LADDER[c.step - 1] : 0; }
        const p = this.players[c.id];
        if (p && c.banked) { p.score += c.banked; p.stats.points += c.banked; this.fx('points', { pid: c.id, pts: c.banked }); }
      }
      this.q = null;
      this.phase = 'ladderEnd';
      this.after(6000, () => this.endRound());
      this.changed();
    }

    /* ---- Duel ---- */
    duelStart() {
      const r = this.round;
      r.hp = {};
      this.activePlayers().slice(0, 2).forEach((p) => (r.hp[p.id] = 100));
      r.fighters = Object.keys(r.hp);
      r.total = 30;
      this.duelNext();
    }
    duelNext() {
      const r = this.round;
      const alive = r.fighters.filter((id) => r.hp[id] > 0);
      if (alive.length < 2 || r.n >= r.total) return this.duelKO();
      r.n++;
      const diff = clamp(3 + Math.floor(r.n / 2), 3, 10);
      const data = this.pickQuestion({ types: ['qcm', 'vf'], diff });
      if (!data) return this.duelKO();
      const q = this.makeQ(data, 'buzz', r.fighters.slice());
      q.buzz = { open: true, locked: [], current: null, pending: [], readyAt: now() + readTime(data.question) };
      this.after(q.buzz.readyAt - now(), () => this.changed());
      this.startTimer(TIMES.duelBuzz + Math.min(6000, data.question.length * 40), () => this.buzzTimeout());
      this.fx('question');
      this.changed();
    }
    duelHit(pid) {
      const r = this.round, q = this.q;
      const p = this.players[pid];
      const foe = r.fighters.find((id) => id !== pid);
      p.streak++; p.stats.correct++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      let dmg = 10 + 2 * q.data.difficulte;
      const crit = p.streak >= 3;
      if (crit) dmg = Math.round(dmg * 1.5);
      r.hp[foe] = Math.max(0, r.hp[foe] - dmg);
      p.score += dmg;
      q.results[pid] = { correct: true, pts: dmg, dmg, crit };
      r.lastHit = { from: pid, to: foe, dmg, crit, at: Date.now() };
      this.fx('hit', { pid: foe, dmg, crit });
      this.say('duelHit', { name: p.name }, 'surprised');
      this.reveal();
    }
    duelKO() {
      const r = this.round;
      this.clearJobs(); this.stopTimer();
      this.q = null;
      const [a, b] = r.fighters;
      r.winner = r.hp[a] === r.hp[b] ? (this.players[a].score >= this.players[b].score ? a : b) : r.hp[a] > r.hp[b] ? a : b;
      this.phase = 'ko';
      this.fx('ko', { pid: r.winner });
      this.say('duelKO', { name: this.name(r.winner) }, 'happy');
      if (this.auto) this.after(6000, () => this.endGame());
      this.changed();
    }

    /* ======================= Fin de partie ======================== */
    endGame() {
      this.clearJobs();
      this.stopTimer();
      this.q = null;
      this.phase = 'end';
      this.updateRankStats(true);
      this.titles = this.computeTitles();
      const r = this.ranking();
      if (this.settings.teams) {
        const t = this.teamScores()[0];
        this.say('teamWinner', { team: t.name }, 'happy');
      } else if (r[0]) this.say('finalWinner', { name: r[0].name }, 'happy');
      this.fx('end');
      this.changed();
    }

    /** Titres humoristiques : chaque joueur reçoit le titre qui lui va le mieux. */
    computeTitles() {
      const ps = this.activePlayers();
      const rk = this.ranking();
      const last = rk[rk.length - 1];
      const C = [
        { t: 'Encyclopédie sur pattes', d: 'Le plus de bonnes réponses', s: (p) => p.stats.correct, min: 3 },
        { t: 'Sniper des fourchettes', d: 'Le plus souvent au plus près de la réponse', s: (p) => p.stats.fourchette, min: 1 },
        { t: 'Gâchette la plus rapide de l’Ouest', d: 'Buzz le plus rapide', s: (p) => (p.stats.fastest != null ? 100000 - p.stats.fastest : 0), min: 1 },
        { t: 'Kamikaze du buzzer', d: 'Le plus de buzz ratés', s: (p) => p.stats.wrongBuzz, min: 2 },
        { t: 'Machiavel de salon', d: 'Le plus de coups bas joués', s: (p) => p.stats.cardsUsed, min: 1 },
        { t: 'Le Phénix', d: 'La plus belle remontée', s: (p) => p.stats.worstRank - this.rankOf(p), min: 2 },
        { t: 'Série en béton armé', d: 'La plus longue série', s: (p) => p.bestStreak, min: 4 },
        { t: 'Alpiniste de l’extrême', d: 'Le plus haut sur l’Échelle', s: (p) => p.stats.ladder, min: 3 },
        { t: 'Prudent comme un notaire', d: 'S’est arrêté sur l’Échelle', s: (p) => (p.stats.ladderStop ? 1 : 0), min: 1 },
        { t: 'Roi du hasard', d: 'Des questions dures réussies... avec une réussite globale douteuse', s: (p) => (p.stats.hardCorrect >= 1 && p.stats.correct / Math.max(1, p.stats.correct + p.stats.wrong) < 0.5 ? 10 + p.stats.hardCorrect : 0), min: 1 },
        { t: 'Cerveau des questions impossibles', d: 'Le plus de questions très dures réussies', s: (p) => p.stats.hardCorrect, min: 2 },
      ];
      const out = {};
      const taken = new Set();
      // On attribue d'abord les titres les plus "marquants".
      for (const c of C) {
        const best = ps.filter((p) => !out[p.id]).map((p) => ({ p, v: c.s(p) })).filter((x) => x.v >= c.min).sort((a, b) => b.v - a.v)[0];
        if (best && !taken.has(c.t)) { out[best.p.id] = { title: c.t, desc: c.d }; taken.add(c.t); }
      }
      const fallback = [
        { title: 'Touriste de luxe', desc: 'Est venu, a vu, a peu répondu' },
        { title: 'Valeur sûre', desc: 'Toujours là quand il faut' },
        { title: 'Candidat mystère', desc: 'Personne ne sait vraiment ce qu’il s’est passé' },
        { title: 'Spectateur engagé', desc: 'Le public t’adore' },
      ];
      ps.forEach((p, i) => {
        if (!out[p.id]) out[p.id] = p === last && ps.length > 1 ? { title: 'Lanterne rouge, mais avec panache', desc: 'Il en faut bien un' } : fallback[i % fallback.length];
      });
      return out;
    }

    /* ======================= Messages entrants ==================== */
    handle(pid, m) {
      const p = this.players[pid];
      if (!p) return;
      switch (m.t) {
        case 'buzz': return this.buzz(pid);
        case 'answer': return this.answer(pid, m.value);
        case 'level': return this.chooseLevel(pid, m.value);
        case 'pick': return this.tablePick(pid, m.value);
        case 'target': return this.tableTarget(pid, m.value);
        case 'theme': return this.quatreTheme(pid, m.value);
        case 'joker': return this.joker(pid, m.kind, m.arg);
        case 'stop': return this.ladderStop(pid);
        case 'vote': return this.vote(pid, m.value);
        case 'card': return this.useCard(pid, m.card, m.target);
        case 'profile': return this.updateProfile(pid, m);
      }
    }
    handlePresenter(m) {
      switch (m.cmd) {
        case 'next': return this.advance();
        case 'reveal': return this.forceReveal();
        case 'validate': return this.validate(true);
        case 'refuse': return this.validate(false);
        case 'clue': this.clearJobs(); return this.nextClue();
        case 'pause': return this.togglePause();
        case 'skip': if (this.q && this.phase === 'question') { this.q.skipped = true; this.forceReveal(); } return;
        case 'points': return this.addPoints(m.pid, Number(m.delta) || 0);
        case 'start': if (this.phase === 'lobby') { const err = this.start(); if (err) this.hooks.toast && this.hooks.toast(err); } return;
      }
    }

    /* ======================= Vues des téléphones ================== */
    meInfo(p) {
      return {
        id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score, rank: this.rankOf(p), total: this.activePlayers().length,
        team: this.settings.teams ? p.team : null, teamName: this.settings.teams ? PQA.TEAM_NAMES[p.team] : null, teamColor: this.settings.teams ? PQA.PALETTE.team[p.team] : null,
        streak: p.streak, mult: this.multiplier(p), cards: p.cards.slice(), double: p.double,
        frozen: this.isFrozen(p) ? Math.ceil((p.frozenUntil - now()) / 1000) : 0,
      };
    }
    choicesFor(p, q, hidden = []) {
      if (!q.choices) return null;
      let order = q.choices.map((_, i) => i);
      const mirror = p.mirrorQ === q.id;
      if (mirror) order = p.mirrorOrder;
      return { mirror, list: order.map((i) => ({ i, text: q.choices[i], hidden: hidden.includes(i) })) };
    }
    viewFor(pid) {
      const p = this.players[pid];
      if (!p) return { screen: 'kicked' };
      const v = { me: this.meInfo(p), phase: this.phase, mode: this.settings.mode, round: this.round ? this.round.type : null, others: this.activePlayers().filter((x) => x.id !== pid).map((x) => ({ id: x.id, name: x.name, color: x.color })), canCard: this.phase !== 'lobby' && this.phase !== 'end' && this.settings.mode !== 'duel', paused: this.paused };
      const q = this.q, r = this.round;
      const withTimer = () => { if (this.timer) v.timer = { key: this.timer.key, total: this.timer.total }; };
      const result = () => {
        const res = q && q.results[pid];
        v.screen = 'result';
        if (q && q.answerers.includes(pid) && res) { v.correct = res.correct; v.pts = res.pts; v.none = res.none; }
        else v.correct = null;
        v.answer = q ? this.answerText(q) : '';
        if (q && q.data.type === 'fourchette' && q.answers[pid]) {
          v.guess = PQA.fmtVal(q.answers[pid].value, q.data.unite);
          v.gap = res && res.gap ? PQA.fmtVal(res.gap, q.data.unite === 'année' ? 'ans' : q.data.unite) : null;
          v.exact = !!(res && res.exact);
        }
        v.anecdote = q ? q.data.anecdote : '';
      };
      switch (this.phase) {
        case 'lobby': v.screen = 'lobby'; break;
        case 'intro': v.screen = 'wait'; v.title = PQA.ROUNDS[r.type].name; v.msg = PQA.ROUNDS[r.type].desc; break;
        case 'leaderboard': v.screen = 'wait'; v.title = 'Classement'; v.msg = 'Tu es ' + (v.me.rank === 1 ? '1er' : v.me.rank + 'e') + ' avec ' + p.score + ' pts'; break;
        case 'wheel': v.screen = 'wait'; v.title = 'La roue tourne...'; v.msg = r.player === pid ? 'C’est ton tour !' : 'Tour de ' + this.name(r.player); break;
        case 'level':
          if (r.player === pid) { v.screen = 'level'; v.cat = r.cat; v.icon = this.catIcon(r.cat); withTimer(); }
          else { v.screen = 'wait'; v.title = r.cat; v.msg = this.name(r.player) + ' choisit son niveau...'; }
          break;
        case 'board':
          if (r.player === pid) { v.screen = 'pick'; v.cells = r.cells.map((c) => ({ i: c.i, icon: c.icon, cat: c.cat, used: c.used })); v.cols = r.cols; withTimer(); }
          else { v.screen = 'wait'; v.title = 'Table des Savoirs'; v.msg = this.name(r.player) + ' choisit une case...'; }
          break;
        case 'cell': v.screen = 'wait'; v.title = r.cell.special === 'piege' ? '💣 PIÈGE !' : r.cell.special === 'double' ? '✖️2 DOUBLE !' : r.cell.special === 'vol' ? '🦹 VOL !' : r.cell.cat; v.msg = r.cell.value + ' points'; break;
        case 'target':
          if (r.player === pid) { v.screen = 'target'; v.title = 'Qui veux-tu voler ?'; v.targets = v.others; v.action = 'target'; withTimer(); }
          else { v.screen = 'wait'; v.title = '🦹 Vol de points'; v.msg = this.name(r.player) + ' choisit sa victime...'; }
          break;
        case 'qpick':
          if (r.player === pid) { v.screen = 'themes'; v.themes = r.themes; withTimer(); }
          else { v.screen = 'wait'; v.title = '4 à la suite'; v.msg = this.name(r.player) + ' choisit son thème...'; }
          break;
        case 'qresult': v.screen = 'wait'; v.title = r.run.won ? '4 À LA SUITE !' : 'Fin du chrono'; v.msg = this.name(r.player) + ' : meilleure série ' + r.run.best + '/4'; break;
        case 'ladder': v.screen = 'wait'; v.title = 'Finale : l’Échelle'; v.msg = r.climbers.map((c) => this.name(c.id)).join(' et ') + ' en finale !'; break;
        case 'ladderEnd': v.screen = 'wait'; v.title = 'Fin de l’ascension'; v.msg = r.climbers.map((c) => this.name(c.id) + ' : +' + c.banked).join(' · '); break;
        case 'ko': v.screen = 'wait'; v.title = 'K.O. !'; v.msg = r.winner === pid ? 'Tu as gagné le duel !' : this.name(r.winner) + ' gagne le duel'; break;
        case 'end': {
          v.screen = 'end';
          const t = this.titles && this.titles[pid];
          v.title = t ? t.title : '';
          v.desc = t ? t.desc : '';
          if (this.settings.teams) { const ts = this.teamScores(); v.teamRank = ts.findIndex((x) => x.team === p.team) + 1; v.winnerTeam = ts[0].name; }
          break;
        }
        case 'reveal': result(); if (r.type === 'echelle' && this.revealPending) { v.screen = 'wait'; v.title = 'Suspense...'; v.msg = '🥁'; } break;
        case 'question': this.questionView(p, v, withTimer); break;
        default: v.screen = 'wait';
      }
      return v;
    }
    questionView(p, v, withTimer) {
      const q = this.q, r = this.round, pid = p.id;
      const d = q.data;
      v.qid = q.id;
      v.question = d.question;
      v.type = d.type;
      withTimer();
      if (q.kind === 'all') {
        if (q.answers[pid]) { v.screen = 'locked'; v.msg = 'Réponse enregistrée !'; v.picked = q.answers[pid].value; v.unite = d.unite; v.choices = this.choicesFor(p, q); return; }
        if (d.type === 'fourchette') { v.screen = 'range'; v.unite = d.unite || ''; v.bornes = d.bornes; v.step = d.pas || null; return; }
        v.screen = 'choices'; v.choices = this.choicesFor(p, q); return;
      }
      if (q.kind === 'single' || q.kind === 'quatre') {
        if (!q.answerers.includes(pid)) { v.screen = 'wait'; v.title = d.type === 'libre' ? 'Question libre' : 'Question'; v.msg = 'À ' + this.name(q.answerers[0]) + ' de jouer !'; return; }
        if (q.kind === 'quatre') { v.run = { streak: r.run.streak, best: r.run.best, last: r.run.last }; v.cat = r.cat; }
        if (q.answers[pid] && q.kind !== 'quatre') { v.screen = 'locked'; v.msg = q.pending ? 'Le présentateur valide...' : 'Réponse enregistrée !'; return; }
        if (d.type === 'libre') { v.screen = this.irl ? 'oral' : 'text'; return; }
        v.screen = 'choices'; v.choices = this.choicesFor(p, q); return;
      }
      if (q.kind === 'buzz') {
        const b = q.buzz;
        if (b.current === pid) {
          if (d.type === 'indices') { v.screen = this.irl ? 'oral' : 'text'; if (q.pending) { v.screen = 'locked'; v.msg = 'Le présentateur valide...'; } return; }
          v.screen = 'choices'; v.choices = this.choicesFor(p, q); v.buzzed = true; return;
        }
        if (!q.answerers.includes(pid)) { v.screen = 'wait'; v.title = 'Duel'; v.msg = 'Regarde l’écran !'; return; }
        v.screen = 'buzzer';
        v.buzz = b.locked.includes(pid) ? 'locked' : b.current ? 'other'
          : p.buzzBlockedUntil && now() < p.buzzBlockedUntil ? 'blocked' : b.readyAt && now() < b.readyAt ? 'early' : 'open';
        if (b.current) { v.buzzer = this.name(b.current); v.buzzerColor = this.players[b.current].color; }
        if (d.indices) v.clue = d.indices[q.clue];
        const duel = this.round.type === 'duel';
        v.penalty = duel ? BUZZ.duelPenalty + ' PV' : BUZZ.penalty;
        v.answerSecs = (this.irl && d.type === 'indices' ? TIMES.buzzAnswerIRL : d.type === 'indices' ? BUZZ.answerText : BUZZ.answer) / 1000;
        return;
      }
      if (q.kind === 'ladder') {
        const c = this.climber(pid);
        if (c && q.answerers.includes(pid)) {
          if (c.status !== 'active') { v.screen = 'wait'; v.title = 'Tu t’arrêtes ici'; v.msg = '+' + c.banked + ' points assurés'; return; }
          v.screen = 'ladder';
          v.choices = this.choicesFor(p, q, c.hidden);
          v.step = c.step; v.ladder = PQA.LADDER; v.safe = PQA.LADDER_SAFE;
          v.jokers = c.jokers; v.picked = c.answer; v.canStop = c.step > 0 && c.answer == null;
          v.friends = this.connectedPlayers().filter((x) => !this.climber(x.id)).map((x) => ({ id: x.id, name: x.name, color: x.color }));
          const rv = this.round.vote;
          if (rv && !rv.open) v.voteDist = rv.dist;
          return;
        }
        const rv = this.round.vote;
        if (rv && rv.open && rv.voters.includes(pid)) { v.screen = 'vote'; v.choices = this.choicesFor(p, q); v.voted = rv.votes[pid]; return; }
        const f = this.round.friend;
        if (f && f.id === pid && !f.done) { v.screen = 'friend'; v.from = this.name(f.from); v.choices = this.choicesFor(p, q); v.friendEnd = Math.max(0, f.end - now()); return; }
        v.screen = 'wait'; v.title = 'Finale'; v.msg = 'Encourage ' + q.answerers.map((id) => this.name(id)).join(' et ') + ' !';
      }
    }
    answerText(q) {
      const d = q.data;
      if (d.type === 'fourchette') return PQA.fmtVal(d.reponse, d.unite);
      return String(d.reponse);
    }

    /** Vue de la télécommande du présentateur IRL : tout, y compris la réponse. */
    presenterView() {
      const q = this.q, r = this.round;
      const v = {
        phase: this.phase, mode: this.settings.mode, paused: this.paused, round: r ? r.type : null, roundName: r ? PQA.ROUNDS[r.type].name : '',
        players: this.ranking().map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, connected: p.connected || p.local, team: p.team })),
        canStart: this.phase === 'lobby' && this.activePlayers().length > 0,
      };
      if (this.timer) v.timer = { key: this.timer.key, total: this.timer.total };
      if (q) {
        const d = q.data;
        v.q = { question: d.question, type: d.type, categorie: d.categorie, difficulte: d.difficulte, answer: this.answerText(q), accepted: d.reponses_acceptees || [], anecdote: d.anecdote, choices: q.choices, correctIdx: q.correctIdx, indices: d.indices, clue: q.clue, revealed: !!q.revealed };
        if (q.pending) v.pending = { pid: q.pending.pid, name: this.name(q.pending.pid), text: q.pending.text };
        if (q.kind === 'buzz' && q.buzz.current) v.pending = v.pending || { pid: q.buzz.current, name: this.name(q.buzz.current), text: this.irl && d.type === 'indices' ? '(répond à l’oral)' : null, oral: this.irl && d.type === 'indices' };
        if (q.kind === 'single' && this.irl && d.type === 'libre' && !q.revealed) {
          const pid = q.answerers[0];
          v.pending = { pid, name: this.name(pid), text: '(répond à l’oral)', oral: true };
        }
        v.answered = Object.keys(q.answers).length;
        v.expected = q.answerers.length;
      }
      if (r && this.phase === 'level') v.info = this.name(r.player) + ' choisit son niveau (' + r.cat + ')';
      if (r && this.phase === 'board') v.info = this.name(r.player) + ' choisit une case';
      return v;
    }

    /* ======================= Sauvegarde (rechargement de l'hôte) == */
    snapshot() {
      return {
        v: 1, at: Date.now(), code: this.code, settings: this.settings, order: this.order, roundIdx: this.roundIdx, rounds: this.rounds, phase: this.phase,
        players: this.playerList().map((p) => ({ ...p, connected: false })), used: Array.from(this.used), nextId: this.nextId,
      };
    }
    restore(s) {
      this.settings = s.settings;
      this.order = s.order;
      this.players = {};
      s.players.forEach((p) => (this.players[p.id] = { ...p, frozenUntil: 0, connected: !!p.local }));
      this.used = new Set(s.used);
      this.nextId = s.nextId + 1;
      this.rounds = s.rounds;
      if (s.phase === 'lobby' || !s.rounds) { this.phase = 'lobby'; this.changed(); return; }
      if (s.phase === 'end') { this.roundIdx = s.rounds.length; this.endGame(); return; }
      // On reprend au début de la manche en cours.
      this.roundIdx = Math.max(-1, s.roundIdx - 1);
      this.phase = 'leaderboard';
      this.round = { type: s.rounds[Math.max(0, s.roundIdx)] };
      this.changed();
    }
  }

  PQA.Game = Game;
  PQA.TIMES = TIMES;
})();
