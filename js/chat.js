/* =========================================================================
 * PIXEL QUIZ ARENA - Chat de la partie et répliques de Pixou
 *
 * Le chat passe par le plateau (comme tout le reste) : un téléphone envoie
 * { t: 'chat', text }, le plateau filtre le message, le diffuse à tout le
 * monde, et Pixou y répond de temps en temps avec une réplique toute faite,
 * choisie selon le message. Quand on lui parle, il ne répond pas : il clashe.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

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

  /* ---- Répliques de Pixou ---- */
  const CANNED = {
    // Quand on lui parle, Pixou ne répond pas : il « bâche » la personne. Vannes et insultes de cour de récré,
    // sur le jeu, le score, la culture ou ce qu'elle écrit, jamais sur ce qu'elle est (physique, origine...).
    roast: [
      'Écoute-moi bien, patate : concentre-toi sur le quiz, pas sur moi.', '{name}, tu as autant de chances d’avoir une réponse que de gagner. Donc zéro.',
      'Ah, {name} veut discuter. Dommage, je ne parle pas le cornichon.', 'Chut, {name}. Les adultes jouent.',
      'Quelle andouille, {name}. Au moins c’est constant.', '{name}, même mon public en pixels a plus de neurones que toi.',
      'Tu écris aussi lentement que tu buzzes, {name}.', 'Merci pour ton message, {name}. Je l’ai rangé avec tes bonnes réponses : nulle part.',
      'Pose ton téléphone, {name}, tu risques de te faire mal.', '{name}, tête de linotte, la question c’est sur l’écran, pas dans le chat.',
      'Ma parole, {name}, tu es un boulet de compétition.', 'Oh, {name} me cause ! Appelez la sécurité.',
      'Tu sais ce qui est vide, {name} ? Ton message. Et ta tête.', 'Je ne réponds pas aux quiches, {name}. Règle du plateau.',
      '{name}, tu as le niveau d’une moule sur un rocher. Une moule fière, mais une moule.', 'Va réviser, banane.',
      'Je t’adore, {name}. Comme on adore un poisson rouge qui se cogne dans la vitre.', 'Chaque message de {name} me coûte un neurone. Il m’en reste trois.',
      'Non.', 'Chère nouille, je ne réponds qu’aux gens intelligents. Tu peux attendre longtemps.',
      '{name}, j’ai vu des grille-pain plus malins. Et ils parlent moins.', 'Tu crois vraiment que je vais t’aider, {name} ? C’est touchant. Naïf, mais touchant.',
      'Calme-toi, {name}. Respire. Et surtout, arrête d’écrire.', '{name}, tu me poses une question ? Tu as déjà épuisé tes deux neurones ?',
      'Ferme-la, {name}, tu fais baisser le QI du plateau.', 'Ta culture générale tient sur un post-it, {name}. Et il reste de la place.',
      '{name}, si la bêtise rapportait des points, tu aurais le titre mondial.', 'Je préfère parler à mon micro, {name}. Il a plus de conversation.',
      'Encore toi, {name} ? Même les pubs sont moins insistantes.', 'Tocard.',
      'T’es le genre de candidat qu’on invite pour que les autres se sentent intelligents, {name}.', '{name}, ton cerveau est en mode avion ?',
      'Tu tapes avec les coudes, {name}, ou c’est naturel ?', 'Si j’avais voulu l’avis d’un guignol, j’aurais acheté un guignol, {name}.',
      'Laisse tomber, {name}. Toi et moi, on ne joue pas dans la même catégorie. Moi je joue, toi tu décores.', 'Bel effort, {name}. Inutile, mais bel effort.',
      '{name}, tu viens de faire perdre 10 points de QI à tous ceux qui ont lu ton message.', 'Concentre-toi, nullos. Enfin, essaie.',
      'Je ne parle pas aux figurants, {name}.', '{name}, tu es la preuve vivante qu’on peut jouer à un quiz sans rien savoir.',
      'Arrête de m’écrire, {name}, ça ne te rendra pas plus malin.', 'Tu me parles à moi, espèce de cruche ?',
      'Ton message est comme tes réponses, {name} : à côté de la plaque.', 'Mais qui a laissé {name} avoir un téléphone ?',
      '{name}, je t’aurais bien répondu, mais je ne veux pas t’embrouiller.', 'Un jour, {name}, tu diras quelque chose d’intelligent. Pas aujourd’hui.',
      'Mon public en pixels a voté : {name}, tu es éliminé de la conversation.', 'Gros bouffon.',
      '{name}, ta place n’est pas dans un quiz, c’est dans le public. Et encore, au fond.', 'Je réponds aux questions intelligentes, {name}. Donc pas à toi.',
      'Tu as pensé à rebrancher ton cerveau ce matin, {name} ?', 'Quelle répartie, {name} ! On dirait un pigeon qui essaie de jouer aux échecs.',
      'Pour te répondre, {name}, il faudrait que ta question ait un sens.', 'Écris moins, réfléchis plus. Ah non, pardon {name}, c’est trop te demander.',
      'Je t’ignore, {name}. C’est mon cadeau pour toi.', '{name}, même Google ne voudrait pas de tes questions.',
      'Attention, {name} s’exprime. Tout le monde baisse les yeux, c’est gênant.', 'Le neuneu du jour, c’est {name}. On applaudit bien fort.',
    ],
    // Quand on lui pose une question : surtout ne pas répondre.
    roastAsk: [
      'Une question, {name} ? C’est moi qui pose les questions ici, gland.', 'La réponse est non. Quelle que soit la question, {name}.',
      'Bonne question, {name}. Dommage qu’elle vienne de toi.', 'Je sais la réponse, {name}. Et c’est exactement pour ça que je ne te la donnerai pas.',
      'Cherche, {name}. Ça te fera faire un peu de sport cérébral, pour une fois.', 'Tu veux la réponse ? Moi je veux un candidat intelligent. On ne peut pas tout avoir, {name}.',
      'Demande à ton voisin, {name}. Ah non, il est aussi perdu que toi.', 'Hmm... non. Prochaine question. Ah non, tu n’en as pas d’autres, {name}.',
      '{name}, tu poses des questions comme tu réponds : mal.', 'Je ne réponds pas aux questions, {name}. Surtout pas aux tiennes.',
      'Pose plutôt la question à ton cerveau, {name}. Ah, il est en grève ?', 'Sérieusement, {name} ? Tu veux que je joue à ta place ?',
      'Oui. Non. Peut-être. Débrouille-toi, {name}.', 'Point d’interrogation détecté. Neurone non détecté.',
    ],
    roastGame: [
      'Tu me parles, {name} ? Avec {score} points, moi je me tairais.', 'Pardon {name}, je ne réponds pas aux candidats classés {rank}e.',
      'Je réponds dès que tu dépasses {leader}. Autant dire jamais.', '{rank}e au classement et ça vient me chercher ? Courageux, {name}. Pas malin, mais courageux.',
      '{score} points, {name}. Mon grille-pain en a fait plus.', 'Reviens me parler quand tu auras plus de points que de messages, {name}.',
      '{name}, {rank}e. Le chiffre parfait pour te taire.', 'Avec {score} points, tu devrais plutôt écrire des excuses, {name}.',
      'Regarde le classement, {name}, puis regarde-toi. Voilà, tu as ta réponse.', '{leader} mène et toi tu bavardes. Tout s’explique, {name}.',
      'Ton score fait pitié, {name}. Même le public en pixels détourne le regard.', '{name}, tu joues ou tu fais de la figuration ? Vu tes {score} points, je penche pour la figuration.',
      'Concentre-toi sur la partie, {name}. Enfin, sur ce qu’il en reste pour toi.', '{rank}e au classement et ça la ramène. On aura tout vu.',
    ],
    roastLast: [
      'Bon, {name}, tu fermes la marche, alors je vais être gentil : non.', 'Le dernier du classement qui m’interpelle ! {name}, c’est beau, cette confiance sans raison.',
      '{name}, tu es en bas du classement et en bas de ma liste de priorités.', 'Dernier du classement et bavard. Le combo gagnant, {name}.',
      'Tu es tellement loin, {name}, que le premier ne te voit plus dans son rétro.', '{name}, au lieu d’écrire, essaie de marquer un point. Un seul. Pour voir.',
      'La lanterne rouge prend la parole ! {name}, éclaire-nous de ton ignorance.', 'Tout en bas du classement, {name}. Même les ordis ont pitié de toi.',
    ],
    roastFirst: [
      '{name} est en tête et se croit tout permis. Profite, ça ne va pas durer.', 'Oui {name}, tu es en tête. Non, ça ne t’autorise pas à me parler.',
      'Numéro 1, {name} ? Les autres sont juste encore plus nuls que toi.', '{name} mène, et ça lui monte déjà à la tête. Il y avait de la place, remarque.',
      'Le leader qui frime dans le chat. Classique. La chute n’en sera que plus drôle, {name}.', 'En tête, {name} ? Chance du débutant. Ou triche. Je vérifie.',
    ],
    greet: [
      'Salut {name}. Ne te fatigue pas à être poli, ça ne te fera pas gagner de points.', 'Coucou {name} ! Tu viens jouer ou juste perdre ?',
      'Tiens, {name}. On attendait quelqu’un pour finir dernier, merci d’être là.', 'Bonjour {name}. Garde ton énergie, tu vas en avoir besoin pour te ridiculiser.',
      'Salut {name} ! Le public t’applaudit. Enfin, il rigole, mais c’est presque pareil.', 'Wesh {name}. Pose tes affaires, ton cerveau aussi, tu ne t’en serviras pas.',
      'Bienvenue {name} ! Ça me fait plaisir. Non, je mens.',
    ],
    laugh: [
      'Ça te fait rire, {name} ? Attends de voir ton score.', 'Ha ha. Je note l’humour de {name} : 2 sur 10, et c’est généreux.',
      'Rigole, {name}, rigole. Le classement, lui, se moque de toi en silence.', '{name} se marre. C’est souvent comme ça juste avant une mauvaise réponse.',
      'Ton rire, {name}, c’est le même bruit que ton buzzer quand tu te trompes.', 'Oui, c’est drôle. Surtout toi, {name}.',
    ],
    easy: [
      'Trop facile, {name} ? Alors pourquoi tu n’as pas trouvé ?', 'Facile, hein ? On en reparle quand tu auras marqué un point, {name}.',
      'Attention {name}, l’orgueil précède souvent le buzz raté. Et chez toi, tout est raté.', 'Fastoche, dit celui qui a {score} points.',
      'Noté, {name}. Je demande des questions niveau expert rien que pour toi. Prépare-toi à pleurer.', 'C’est facile pour tout le monde, {name}. Sauf pour toi, apparemment.',
    ],
    hard: [
      'Trop dur ? Pourtant ma grand-mère a trouvé, {name}. Et elle est en pixels.', 'Difficile pour toi, {name}. Tout est difficile pour toi.',
      'Il n’y a pas de questions difficiles, {name}. Il n’y a que des candidats comme toi.', 'Ah, ça coince, {name} ? Normal, il faut un cerveau pour ce jeu.',
      'Pleure pas, {name}. Ou alors pleure, mais en silence.', 'Courage, {name}. Ou abandonne, ça ira plus vite.',
    ],
    cheat: [
      'Tricher ? Ici ? Non, {name}, tu es juste mauvais. C’est différent.', 'L’arbitrage est sans appel, {name}. Je suis l’arbitre. Et l’appel. Et toi, le perdant.',
      'Réclamation enregistrée, {name}. Elle sera étudiée en l’an 3000.', 'Le jeu n’est pas truqué, {name}. C’est ton cerveau qui est en panne.',
      'Un bug ? Oui, {name}. Il s’appelle toi.', 'Arrête de chercher des excuses, {name}. Assume ta nullité.',
    ],
    brag: [
      'Quelle confiance, {name} ! Dommage que le talent ne suive pas.', '{name} se voit déjà au sommet. Le public, lui, se voit déjà rigoler.',
      'Tu vas gagner, {name} ? Et moi je vais devenir un vrai humain.', 'Redescends, {name}, tu vas te faire mal en tombant.',
      'Le melon de {name} vient de prendre deux tailles. Le score, lui, ne bouge pas.', 'Médaille d’or de la frime, {name}. Pour le reste, on attend encore.',
    ],
    sad: [
      'Oh, {name} a le cafard. Tout le monde s’en fiche, mais c’est mignon.', 'Ne baisse pas les bras, {name}. Il te faut les deux pour buzzer. Pour rater, aussi.',
      'C’est pas grave, {name}. L’important, c’est de participer. Et toi, tu participes beaucoup à faire rire.', 'Ouin ouin. Mouche-toi, {name}, et reprends le jeu.',
      'Tu as perdu, {name} ? Je suis surpris. Non, je rigole.', 'Allez {name}, reprends-toi. Ou pas, c’est plus drôle comme ça.',
    ],
    gg: [
      'Du fair-play, {name} ? Ça ne te rapportera aucun point, mais c’est beau. Inutile, mais beau.', 'Bravo pour les bravos, {name}. Maintenant, joue.',
      'Que de bons sentiments, {name}. Ça cache quelque chose. Probablement un score minable.',
    ],
    emoji: [
      'Un émoji, {name} ? Tu as oublié comment on fait les phrases ?', 'Je vois que {name} parle couramment l’émoji. Faute de mieux.',
      'Bel émoji, {name}. C’est ce que tu as fait de plus intelligent ce soir.', '{name} communique par dessins. On progresse, on progresse.',
      'Même ton émoji a l’air perdu, {name}.',
    ],
    leader: [
      '{leader} est en tête, et je sens que ça agace un peu tout le monde.', 'Pendant que vous discutez, {leader} engrange les points. Bande de nazes.',
      'Continuez à papoter. {leader} vous remercie.',
    ],
    generic: [
      'Passionnant, {name}. Vraiment. On reprend le quiz ?', 'Je note, {name}. Puis je jette.', 'Merci pour cette intervention inutile, {name}.',
      'Intéressant, {name}. Ça vaut combien de points, ça ? Zéro. Comme toi.', 'Si les messages rapportaient des points, {name} serait enfin en tête.',
      'Je fais semblant de ne pas avoir lu, {name}. Pour ton bien.', 'Personne n’a demandé, {name}.', 'Et sinon, {name}, tu joues de temps en temps ?',
      'Ton message mérite une réponse, {name}. Il ne l’aura pas.', 'Fascinant. Au suivant.',
    ],
    rude: [
      'Oh là, {name}, on reste poli sur mon plateau ! Ici, c’est moi qui insulte.', 'Les gros mots, c’est pour ceux qui n’ont pas de répartie. Comme toi, donc, {name}.',
      'Mon filtre a censuré ton message, {name}. Il est mieux élevé que toi.', 'Des gros mots, {name} ? Ton vocabulaire est aussi limité que ta culture.',
      'Range ta grossièreté, {name}, et sors ton cerveau. Ah, tu n’en as pas pris ?', 'Insulter le présentateur ? Audacieux, {name}. Débile, mais audacieux.',
    ],
  };
  /**
   * Version dite à voix haute : sans le prénom quand Pixou interpelle (« Personne n’a demandé, {name}. »),
   * pour que la phrase soit enregistrée une fois pour toutes dans la banque de voix.
   */
  function spoken(line) {
    const s = line
      .replace(/^\{name\}\s*,\s*/, '')
      .replace(/(:\s*)\{name\}\s*,\s*/g, '$1')
      .replace(/([.!?…]\s+)\{name\}\s*,\s*(\S)/g, (_, a, c) => a + c.toUpperCase())
      .replace(/\s*,\s*\{name\}(?=\s*[,.!?…:])/g, '')
      .replace(/\b(Pardon|pardon|Oui|Salut|Coucou|Bonjour|Wesh|Bienvenue|Allez|Attention) \{name\}/g, '$1');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  const recent = [];
  /** Une réplique au hasard : { text } pour le chat, { spoken } pour la voix. */
  function canned(kind, vars) {
    const list = CANNED[kind] || CANNED.generic;
    const pool = list.filter((l) => !recent.includes(l));
    const line = (pool.length ? pool : list)[Math.floor(Math.random() * (pool.length || list.length))];
    recent.push(line); if (recent.length > 40) recent.shift();
    return { text: fill(line, vars), spoken: fill(spoken(line), vars) };
  }
  /** Devine le genre de message, pour choisir une réplique toute faite. */
  const pick = (a, b) => (Math.random() < 0.4 ? a : b);
  function classify(raw, bad, vars) {
    const t = PQA.normalize ? PQA.normalize(raw) : raw.toLowerCase();
    const low = raw.toLowerCase();
    if (bad) return 'rude';
    // On parle à Pixou : il ne répond jamais vraiment, il clashe.
    if (/pixou/.test(t)) {
      if (/\?/.test(raw) && Math.random() < 0.6) return 'roastAsk';
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
    /** hooks : { broadcast(msg), pixouSpeak(text, spoken) } */
    constructor(game, hooks) {
      this.g = game;
      this.hooks = hooks;
      this.log = [];
      this.seq = 0;
      this.rate = {}; // pid -> horodatages des derniers messages
      this.lastPixou = 0;
      this.busy = false;
    }
    /** Pixou répond-il dans le chat ? (anciens réglages : 'ai' / 'canned' = oui) */
    get pixouMode() { return this.g.settings.pixou === 'off' ? 'off' : 'on'; }

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
      const done = (line) => {
        this.busy = false;
        const text = line && PQA.cleanChat(line.text, 240);
        if (!text) return;
        this.lastPixou = Date.now();
        this.add({ who: 'pixou', name: 'Pixou', text });
        this.hooks.pixouSpeak && this.hooks.pixouSpeak(text, line.spoken);
      };
      const rank = this.g.ranking(), p = this.g.players[entry.pid];
      const vars = { name: entry.name, leader: rank[0] ? rank[0].name : entry.name, score: p ? p.score : 0, rank: p ? this.g.rankOf(p) : 1, total: this.g.phase === 'lobby' ? 0 : rank.length };
      if (vars.leader === entry.name) vars.leader = rank[1] ? rank[1].name : 'le public';
      const delay = 900 + Math.random() * 1400; // le temps de « taper »
      setTimeout(() => done(canned(classify(entry.text, bad, vars), vars)), delay);
    }
  }

  PQA.Chat = Chat;
  PQA.pixouCanned = canned;
  PQA.CHAT_LINES = CANNED; // pour scripts/voice-lines.js
  PQA.chatSpoken = spoken;
})();
