/* =========================================================================
 * PIXEL QUIZ ARENA - Chat de la partie et répliques de Pixou
 *
 * Le chat passe par le plateau (comme tout le reste) : un téléphone envoie
 * { t: 'chat', text }, le plateau filtre le message, le diffuse à tout le
 * monde, et Pixou y répond de temps en temps, avec un sarcasme bienveillant.
 *
 * Les réponses de Pixou viennent :
 *  - d'une IA (Claude), via un petit relais Cloudflare Worker (dossier worker/)
 *    qui garde la clé API secrète. Il suffit d'indiquer son adresse ci-dessous ;
 *  - sinon (pas de relais, hors ligne, erreur), de répliques toutes faites.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  /** Adresse du relais IA de Pixou (Cloudflare Worker, voir worker/pixou/README.md).
   *  Vide = répliques toutes faites. On peut aussi la passer dans l'URL du plateau : ?pixou=https://... */
  const DEFAULT_AI_URL = '';

  PQA.pixouAIURL = function () {
    const qs = new URLSearchParams(location.search);
    let url = qs.get('pixou');
    try {
      if (url) localStorage.setItem('pqa_pixou_ai', url);
      else url = localStorage.getItem('pqa_pixou_ai');
    } catch (e) {}
    if (url === 'off') return '';
    return /^https:\/\//.test(url || '') ? url : DEFAULT_AI_URL;
  };

  /* ---- Modération : messages courts, et les insultes sont masquées ---- */
  // Début de mot (« connard » masque aussi « connards ») / mot exact seulement (« pd » mais pas « pdf »).
  const BANNED_PREFIX = [
    'connard', 'connasse', 'salope', 'salaud', 'pute', 'putain', 'encul', 'niqu', 'batard', 'bâtard', 'enfoir', 'couillon', 'chatte', 'branleu',
    'pétasse', 'petasse', 'négro', 'negro', 'nègre', 'negre', 'bougnoul', 'youpin', 'bicot', 'tapette', 'fuck', 'bitch', 'pussy', 'cunt', 'nigg', 'trisomique', 'gogol',
  ];
  const BANNED_EXACT = ['ntm', 'fdp', 'pd', 'bite', 'bites', 'couille', 'couilles', 'shit', 'dick', 'fag', 'tg', 'suceur', 'suceuse'];
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const L = 'a-zà-ÿ0-9';
  const BANNED_RE = new RegExp('(^|[^' + L + '])((?:' + BANNED_PREFIX.map(esc).join('|') + ')[' + L + ']*|(?:' + BANNED_EXACT.map(esc).join('|') + ')(?![' + L + ']))', 'gi');
  /** Espaces, longueur, caractères invisibles. */
  function squash(text, max) {
    let s = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max - 1) + '…';
    return s;
  }
  const mask = (s) => s.replace(BANNED_RE, (m, pre, word) => pre + word[0] + '*'.repeat(Math.max(2, word.length - 1)));
  /** Nettoie un message : espaces, longueur, et les mots interdits sont masqués. */
  PQA.cleanChat = function (text, max = 140) { return mask(squash(text, max)); };

  /* ---- Répliques toutes faites (quand l'IA n'est pas disponible) ---- */
  const CANNED = {
    greet: ['Bonsoir {name} ! Installe-toi, les questions ne vont pas se rater toutes seules.', 'Salut {name} ! Tu viens jouer ou juste admirer mon brushing ?', 'Coucou {name} ! Le public t’applaudit. Enfin, deux pixels sur trois.', 'Bienvenue {name} ! On t’attendait. Enfin, surtout moi.'],
    pixouBad: ['Je suis un présentateur en pixels, {name}. Tes critiques glissent sur ma laque.', 'Moi, nul ? J’ai seize couleurs et zéro défaut, {name}.', 'Note bien, {name} : c’est moi qui tiens les questions. Je dis ça, je dis rien.', 'Ouh, {name} m’attaque ! Le public est choqué. Moi aussi, un peu.'],
    pixouAsk: ['Bonne question, {name}. La réponse est dans mon cœur, et je ne l’ouvre qu’en direct.', 'Je ne réponds qu’aux questions qui rapportent des points, {name}.', 'Demande à ton voisin, {name}. Ah non, ça s’appelle tricher.', 'Hmm, {name}, je consulte mon équipe de rédaction. Elle est en pause café.'],
    laugh: ['Rire pendant un quiz, c’est bien. Rire en ayant juste, c’est mieux, {name}.', 'Ha ha. Je note l’humour de {name} : 7 sur 10, avec le bonus de pitié.', 'Ça rigole, ça rigole... On verra qui rira au classement !', '{name} se marre. C’est souvent comme ça juste avant une mauvaise réponse.'],
    easy: ['Trop facile, {name} ? Je transmets à la rédaction. Ils adorent les défis.', 'Facile, hein ? On en reparle à la prochaine question, {name}.', 'Attention {name}, l’orgueil précède souvent le buzz raté.', 'Noté, {name}. Je vais demander des questions niveau expert rien que pour toi.'],
    hard: ['Trop dur ? Pourtant ma grand-mère a trouvé. Bon, elle a triché.', 'Courage {name}, se tromper avec style, c’est déjà un talent.', 'Il n’y a pas de questions difficiles, {name}. Il n’y a que des candidats surpris.', 'Si c’était facile, je t’aurais donné une médaille en chocolat, {name}.'],
    cheat: ['Tricher ? Ici ? Jamais. J’ai des yeux partout. Enfin, deux pixels.', 'L’arbitrage est sans appel, {name}. Je suis l’arbitre. Et l’appel.', 'Réclamation enregistrée, {name}. Elle sera étudiée en l’an 3000.'],
    brag: ['Quelle confiance, {name} ! J’adore. Le classement, lui, attend de voir.', '{name} se voit déjà champion. Le public, lui, se voit déjà rigoler.', 'Bravo {name}. Garde un peu de modestie pour la prochaine question.'],
    sad: ['Allez {name}, il reste des points à prendre. Et de l’amour-propre à reconstruire.', 'Ne baisse pas les bras, {name}. Il te faut les deux pour buzzer.', 'C’est pas grave, {name}. L’important, c’est de participer. Je crois.'],
    gg: ['Joli fair-play, {name}. Je pleure un peu. C’est la laque.', 'Que de bons sentiments ! Ça ne vous rapportera aucun point, mais c’est beau.'],
    emoji: ['Je vois que {name} parle couramment l’émoji.', 'Un émoji, {name} ? Je préfère les bonnes réponses, mais j’accepte.', 'Le public apprécie l’émoji de {name}. Enfin, je crois.'],
    leader: ['{leader} est en tête, et je sens que ça agace un peu tout le monde.', 'Pendant que vous discutez, {leader} engrange les points.'],
    generic: ['Passionnant, {name}. Vraiment. On reprend le quiz ?', 'Je note, {name}. Je ne sais pas encore quoi en faire, mais je note.', 'Merci pour cette intervention, {name}. Le public est bouleversé.', 'Ah, {name}, toujours le mot pour rire. Ou presque.', 'Intéressant, {name}. Ça vaut combien de points, ça ?', 'Si les messages rapportaient des points, {name} serait en tête.', 'Je fais semblant de ne pas avoir lu, {name}. Pour ton bien.'],
    rude: ['Oh là, {name}, on reste poli sur mon plateau ! Je baisse ton capital sympathie de 50 %.', 'Langage, {name} ! Ici, les seuls gros mots autorisés sont « bonne réponse ».', 'Je n’ai rien lu, {name}. Mon filtre anti-grossièretés non plus, il est trop bien élevé.'],
  };
  const recent = [];
  function canned(kind, vars) {
    const list = CANNED[kind] || CANNED.generic;
    const pool = list.filter((l) => !recent.includes(l));
    const line = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
    recent.push(line); if (recent.length > 12) recent.shift();
    return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  }
  /** Devine le genre de message, pour choisir une réplique toute faite. */
  function classify(raw, bad) {
    const t = PQA.normalize ? PQA.normalize(raw) : raw.toLowerCase();
    const low = raw.toLowerCase();
    if (bad) return 'rude';
    if (/pixou/.test(t) && /(nul|moche|bete|idiot|naze|bof|ringard|robot|chiant|pourri)/.test(t)) return 'pixouBad';
    if (/pixou/.test(t) && /\?/.test(raw)) return 'pixouAsk';
    if (/^(slt|salut|bonjour|bonsoir|coucou|hello|yo|wesh|hey|cc)\b/.test(t)) return 'greet';
    if (/(triche|arnaque|truque|vol|scandale|injuste|bug)/.test(t)) return 'cheat';
    if (/(trop facile|fastoche|easy|\bez\b|simple)/.test(t)) return 'easy';
    if (/(dur|difficile|impossible|aucune idee|j ?sais pas|chaud)/.test(t)) return 'hard';
    if (/\b(gg|bien joue|bravo|felicitations?)\b/.test(t)) return 'gg';
    if (/(je vais gagner|je gagne|trop fort|imbattable|champion|facile pour moi|le meilleur)/.test(t)) return 'brag';
    if (/(perdu|nul|honte|j y connais rien|catastrophe|ouin|snif)/.test(t) || /😭|😢|😞/.test(low)) return 'sad';
    if (/(ha){2,}|(hi){2,}|mdr|lol|ptdr|xd/.test(t) || /😂|🤣|😆/.test(low)) return 'laugh';
    if (!/[a-z0-9]/.test(t)) return 'emoji';
    return Math.random() < 0.15 ? 'leader' : 'generic';
  }

  class Chat {
    /** hooks : { broadcast(msg), pixouSpeak(text) } */
    constructor(game, hooks) {
      this.g = game;
      this.hooks = hooks;
      this.log = [];
      this.seq = 0;
      this.rate = {}; // pid -> horodatages des derniers messages
      this.lastPixou = 0;
      this.busy = false;
      this.aiDownUntil = 0;
    }
    get aiURL() { return PQA.pixouAIURL(); }
    /** Mode de réponse de Pixou effectivement utilisé. */
    get pixouMode() {
      const m = this.g.settings.pixou || 'ai';
      return m === 'ai' && !this.aiURL ? 'canned' : m;
    }

    add(entry) {
      entry.id = ++this.seq;
      entry.at = Date.now();
      this.log.push(entry);
      if (this.log.length > 60) this.log.shift();
      this.hooks.broadcast({ t: 'chat', m: entry });
      return entry;
    }
    backlog() { return { t: 'chatlog', list: this.log.slice(-40) }; }

    /** Message d'un joueur. Renvoie un texte d'erreur à afficher, ou null. */
    fromPlayer(pid, raw) {
      const p = this.g.players[pid];
      if (!p || typeof raw !== 'string') return null;
      const plain = squash(raw, 140);
      const text = mask(plain);
      if (!text) return null;
      const t = Date.now();
      const hist = (this.rate[pid] = (this.rate[pid] || []).filter((x) => t - x < 20000));
      if (hist.length && t - hist[hist.length - 1] < 1200) return 'Doucement ! Un message à la fois.';
      if (hist.length >= 6) return 'Pause chat de quelques secondes !';
      hist.push(t);
      const entry = this.add({ who: 'p', pid, name: p.name, color: p.color, text });
      this.maybeReply(entry, text !== plain);
      return null;
    }

    /** Pixou ne répond pas à tout : toujours quand on lui parle, sinon de temps en temps. */
    maybeReply(entry, bad) {
      const mode = this.pixouMode;
      if (mode === 'off' || this.busy) return;
      const since = Date.now() - this.lastPixou;
      const named = /pixou/i.test(entry.text);
      const emojiOnly = !/[a-z0-9à-ÿ]/i.test(entry.text);
      let want = named ? since > 3000 : since > 9000 && Math.random() < (emojiOnly ? 0.2 : 0.5);
      if (bad) want = since > 3000;
      if (!want) return;
      this.busy = true;
      const done = (text) => {
        this.busy = false;
        text = text && PQA.cleanChat(text, 240);
        if (!text) return;
        this.lastPixou = Date.now();
        this.add({ who: 'pixou', name: 'Pixou', text });
        this.hooks.pixouSpeak && this.hooks.pixouSpeak(text);
      };
      const leader = this.g.ranking()[0];
      const fallback = () => canned(classify(entry.text, bad), { name: entry.name, leader: leader ? leader.name : entry.name });
      const delay = 900 + Math.random() * 1400; // le temps de « taper »
      if (mode !== 'ai' || bad || Date.now() < this.aiDownUntil) { setTimeout(() => done(fallback()), delay); return; }
      const started = Date.now();
      this.askAI(entry).then((text) => {
        if (!text) throw new Error('vide');
        setTimeout(() => done(text), Math.max(0, delay - (Date.now() - started)));
      }).catch((e) => {
        console.warn('Pixou IA indisponible :', e && e.message);
        this.aiDownUntil = Date.now() + 60000;
        done(fallback());
      });
    }

    /** Résumé de la partie pour l'IA (jamais la réponse d'une question en cours). */
    context() {
      const g = this.g, r = g.round, q = g.q;
      const parts = [];
      const phase = { lobby: 'salon, avant le début de la partie', end: 'fin de partie', leaderboard: 'classement entre deux manches', intro: 'présentation d’une manche' }[g.phase] || 'partie en cours';
      parts.push('Moment : ' + phase + '.');
      if (r && PQA.ROUNDS[r.type]) parts.push('Manche : ' + PQA.ROUNDS[r.type].name + '.');
      if (q && g.phase === 'question') parts.push('Question affichée (ne donne jamais la réponse) : ' + q.data.question);
      if (q && g.phase === 'reveal') parts.push('Question qui vient d’être révélée : ' + q.data.question + ' Réponse : ' + g.answerText(q) + '.');
      const rank = g.ranking().slice(0, 10);
      if (rank.length) parts.push('Classement : ' + rank.map((p, i) => (i + 1) + '. ' + p.name + (p.bot ? ' (ordinateur)' : '') + ' ' + p.score + ' pts').join(', ') + '.');
      return parts.join('\n').slice(0, 900);
    }
    async askAI(entry) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const res = await fetch(this.aiURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            context: this.context(),
            chat: this.log.slice(-12).map((m) => ({ name: m.name, text: m.text, pixou: m.who === 'pixou' })),
            to: entry.name,
          }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return data && typeof data.text === 'string' ? data.text : null;
      } finally { clearTimeout(timer); }
    }
  }

  PQA.Chat = Chat;
  PQA.pixouCanned = canned;
})();
