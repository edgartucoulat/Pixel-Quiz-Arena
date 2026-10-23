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
    // Quand on lui parle, Pixou ne répond pas : il « bâche » la personne (vannes et petites insultes de cour de récré).
    roast: [
      'Écoute-moi bien, petite patate : concentre-toi sur le quiz, pas sur moi.', '{name}, tu as autant de chances d’avoir une réponse que de gagner. Donc zéro.',
      'Ah, {name} veut discuter. Dommage, je ne parle pas le cornichon.', 'Chut, {name}. Les adultes jouent.',
      'Quelle andouille, ce {name}. Au moins c’est constant.', '{name}, même mon public en pixels a plus de neurones que toi.',
      'Tu écris aussi lentement que tu buzzes, {name}.', 'Merci pour ton message, {name}. Je l’ai rangé avec tes bonnes réponses : nulle part.',
      'Pose ton téléphone, {name}, tu risques de te faire mal.', '{name}, tête de linotte, la question c’est sur l’écran, pas dans le chat.',
      'Ma parole, {name}, tu es un boulet de compétition.',
      'Oh, {name} me cause ! Le public, appelez la sécurité.', 'Tu sais ce qui est vide, {name} ? Ton message. Et ton tableau de score.',
      'Je ne réponds pas aux quiches, {name}. Règle du plateau.', '{name}, tu as le niveau d’une moule sur un rocher. Une moule fière, mais une moule.',
      'Va réviser, banane.', 'Je t’adore, {name}. Comme on adore un poisson rouge qui se cogne dans la vitre.',
      'Nouvelle règle : chaque message de {name} me coûte un neurone. Il m’en reste trois.', '{name}, tu me poses une question ? Tu es déjà à court de réponses ?',
      'Non.', 'Chère nouille, je ne réponds qu’aux gagnants. Reviens au podium.',
      '{name}, j’ai vu des grille-pain plus malins. Et ils ne parlent pas autant.', 'Tu crois vraiment que je vais t’aider, {name} ? T’es mignon. Naïf, mais mignon.',
      'Calme-toi, {name}. Respire. Et surtout, arrête d’écrire.',
      '{name}, tu me poses une question ? Tu as déjà épuisé tes neurones ?',
    ],
    roastGame: ['Tu me parles, {name} ? Avec {score} points, moi je me tairais.', 'Pardon {name}, je ne réponds pas aux candidats classés {rank}e.', 'Je réponds dès que tu dépasses {leader}. Autant dire jamais.', 'Classé {rank}e et ça vient me chercher ? Courageux, {name}. Pas malin, mais courageux.'],
    roastLast: ['Bon, {name}, tu fermes la marche, alors je vais être gentil : non.', 'Le dernier du classement qui m’interpelle ! {name}, c’est beau, cette confiance sans raison.', '{name}, tu es en bas du classement et en bas de ma liste de priorités.'],
    roastFirst: ['{name} est en tête et se croit tout permis. Profite, ça ne va pas durer.', 'Oui {name}, tu es en tête. Non, ça ne t’autorise pas à me parler.'],
    greet: ['Bonsoir {name} ! Installe-toi, les questions ne vont pas se rater toutes seules.', 'Salut {name} ! Tu viens jouer ou juste admirer mon brushing ?', 'Coucou {name} ! Le public t’applaudit. Enfin, deux pixels sur trois.', 'Bienvenue {name} ! On t’attendait. Enfin, surtout moi.'],
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
    rude: ['Oh là, {name}, on reste poli sur mon plateau ! Ici, c’est moi qui insulte.', 'Langage, {name} ! Les gros mots, c’est pour ceux qui n’ont pas de répartie. Comme toi, donc.', 'Je n’ai rien lu, {name}. Mon filtre anti-grossièretés non plus, il est mieux élevé que toi.', 'Des gros mots, {name} ? Ton vocabulaire est aussi limité que ton score.'],
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
  const pick = (a, b) => (Math.random() < 0.4 ? a : b);
  function classify(raw, bad, vars) {
    const t = PQA.normalize ? PQA.normalize(raw) : raw.toLowerCase();
    const low = raw.toLowerCase();
    if (bad) return 'rude';
    // On parle à Pixou : il ne répond jamais vraiment, il clashe.
    if (/pixou/.test(t)) {
      if (!vars.total) return 'roast'; // dans le salon, pas encore de classement à lui balancer
      if (vars.total > 1 && vars.rank === 1) return pick('roastFirst', 'roast');
      if (vars.total > 1 && vars.rank === vars.total) return pick('roastLast', 'roast');
      return pick('roastGame', 'roast');
    }
    if (/^(slt|salut|bonjour|bonsoir|coucou|hello|yo|wesh|hey|cc)\b/.test(t)) return 'greet';
    if (/(triche|arnaque|truque|vol|scandale|injuste|bug)/.test(t)) return 'cheat';
    if (/(trop facile|fastoche|easy|\bez\b|simple)/.test(t)) return 'easy';
    if (/(dur|difficile|impossible|aucune idee|j ?sais pas|chaud)/.test(t)) return 'hard';
    if (/\b(gg|bien joue|bravo|felicitations?)\b/.test(t)) return 'gg';
    if (/(je vais gagner|je gagne|trop fort|imbattable|champion|facile pour moi|le meilleur)/.test(t)) return 'brag';
    if (/(perdu|nul|honte|j y connais rien|catastrophe|ouin|snif)/.test(t) || /😭|😢|😞/.test(low)) return 'sad';
    if (/(ha){2,}|(hi){2,}|mdr|lol|ptdr|xd/.test(t) || /😂|🤣|😆/.test(low)) return 'laugh';
    if (!/[a-z0-9]/.test(t)) return 'emoji';
    return Math.random() < 0.4 ? (vars.total ? pick('roastGame', 'roast') : 'roast') : Math.random() < 0.2 ? 'leader' : 'generic';
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
      const rank = this.g.ranking(), p = this.g.players[entry.pid];
      const vars = { name: entry.name, leader: rank[0] ? rank[0].name : entry.name, score: p ? p.score : 0, rank: p ? this.g.rankOf(p) : 1, total: this.g.phase === 'lobby' ? 0 : rank.length };
      if (vars.leader === entry.name) vars.leader = rank[1] ? rank[1].name : 'le public';
      const fallback = () => canned(classify(entry.text, bad, vars), vars);
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
            named: /pixou/i.test(entry.text),
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
