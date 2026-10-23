/* =========================================================================
 * PIXEL QUIZ ARENA - Outils partagés (plateau, manettes, télécommande)
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  PQA.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  PQA.$ = (sel, root = document) => root.querySelector(sel);
  PQA.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Remplace le HTML d'un élément seulement s'il a changé (évite de relancer les animations). */
  PQA.patch = function (el, html) {
    if (!el) return false;
    if (el._html === html) return false;
    el._html = html;
    el.innerHTML = html;
    return true;
  };

  PQA.fmt = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    const abs = Math.abs(n);
    const digits = abs !== Math.floor(abs) ? (abs < 10 ? 2 : 1) : 0;
    return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  };

  /** Valeur + unité ; les années s'affichent sans séparateur (1492, 44 av. J.-C.). */
  PQA.fmtVal = function (n, unite, withUnit = true) {
    if (unite === 'année') return n < 0 ? Math.round(-n) + ' av. J.-C.' : String(Math.round(n));
    return PQA.fmt(n) + (withUnit && unite ? ' ' + unite : '');
  };
  /** Pas "rond" (1, 2, 5, 10, 20, 50...) proche de la valeur donnée. */
  PQA.niceStep = function (raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  };

  /* ---- Validation des réponses libres ---------------------------------- */
  const ARTICLES = /^(le|la|les|l|un|une|des|du|de|d|the|a|an|el|il|lo|der|die|das)\s+/;
  PQA.normalize = function (s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
      .replace(/['’`´]/g, ' ')
      .replace(/&/g, ' et ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(ARTICLES, '')
      .replace(/\s+/g, ' ');
  };

  PQA.levenshtein = function (a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  };

  /** Compare une réponse saisie aux réponses acceptées (accents, articles, fautes de frappe). */
  PQA.matchAnswer = function (input, q) {
    const given = PQA.normalize(input);
    if (!given) return false;
    const list = [q.reponse].concat(q.reponses_acceptees || []).map(PQA.normalize).filter(Boolean);
    const givenNum = Number(given.replace(/ /g, ''));
    for (const ok of list) {
      if (given === ok) return true;
      // Réponses numériques : égalité stricte
      if (/^\d+$/.test(ok)) { if (givenNum === Number(ok)) return true; continue; }
      const tol = ok.length >= 10 ? 2 : ok.length >= 5 ? 1 : 0;
      if (tol && PQA.levenshtein(given, ok) <= tol) return true;
      // Nom de famille seul pour une personne ("Victor Hugo" -> "Hugo") : seulement si accepté explicitement.
    }
    return false;
  };

  /* ---- Métadonnées du jeu ---------------------------------------------- */
  PQA.ROUNDS = {
    sprint: { name: 'Le Sprint', short: 'Sprint', icon: '🏁', desc: 'Une rafale de questions au buzzer sur des thèmes au hasard. Pas de choix : buzze, puis tape ta réponse. Buzz raté = la moitié de la valeur en moins !' },
    mystere: { name: 'Le Thème Mystère', short: 'Thème Mystère', icon: '🎡', desc: 'La roue choisit le thème, tu choisis ton niveau de 1 à 10. Plus c’est dur, plus ça rapporte !' },
    fourchette: { name: 'La Fourchette', short: 'La Fourchette', icon: '📏', desc: 'Donne un seul chiffre et vise pile ! Plus tu es proche de la réponse, plus tu marques.' },
    quatre: { name: 'Le 4 à la suite', short: '4 à la suite', icon: '4️⃣', desc: 'Le 1er du classement choisit son thème en premier, puis le suivant… Un thème pris n’est plus disponible ! Enchaîne 4 bonnes réponses d’affilée en 40 secondes.' },
    eclair: { name: 'Tous en même temps', short: 'QCM éclair', icon: '⚡', desc: 'Tout le monde répond en même temps. Bonus de rapidité pour les plus vifs.' },
    table: { name: 'Les Cases mystères', short: 'Cases mystères', icon: '🎁', desc: 'Choisis une case à tour de rôle : thème et niveau restent secrets jusqu’au choix. Attention aux pièges, aux cases bonus et aux vols de points !' },
    champions: { name: 'Le Duel des champions', short: 'Duel des champions', icon: '⚔️', desc: 'Les 2 meilleurs s’affrontent au buzzer : les indices tombent un à un. Le premier à 3 bonnes réponses gagne la partie !' },
    duel: { name: 'Duel', short: 'Duel', icon: '🥊', desc: 'Chaque bonne réponse inflige des dégâts à l’adversaire. Premier K.O. perdu !' },
  };
  /* Règle détaillée, affichée sur l'écran d'intro de chaque manche (on peut la passer). */
  const RULES = {
    sprint: ['Une question à la fois, sur un thème tiré au hasard.', 'Attends la fin de la lecture, puis buzze le premier : buzzer trop tôt = bloqué 2 s.', 'Tu as 10 secondes pour taper ta réponse. La question vaut de 75 à 300 pts selon sa difficulté.', 'Mauvaise réponse = la moitié de sa valeur en moins, et la main passe aux autres.'],
    mystere: ['La roue tire un thème pour toi.', 'Choisis ton niveau de 1 (facile) à 10 (très dur).', 'Plus le niveau est haut, plus la question rapporte : de 75 à 300 pts… si tu trouves !'],
    eclair: ['Tout le monde répond en même temps sur son téléphone.', 'Une bonne réponse rapporte de 75 à 300 pts selon la difficulté, plus un bonus de rapidité (jusqu’à +50).', 'Une seule réponse possible : pas de deuxième chance !'],
    table: ['Chacun son tour, choisis une case sur le plateau, puis réponds seul à sa question.', 'Le thème et le niveau (facile, moyen, difficile, expert) sont cachés : plus la question est dure, plus elle rapporte (75 à 300 pts).', '💣 Piège : tu perds des points. ⭐ Bonus : +100 pts si tu trouves. 🦹 Vol : si tu trouves, les points sont pris à l’adversaire de ton choix.'],
    quatre: ['Chacun son tour, en commençant par le 1er du classement, choisis un thème. Un thème pris n’est plus disponible.', 'Le « thème mystère » en tire un au hasard.', 'Tu as 40 secondes : chaque bonne réponse vaut 50 pts, une erreur remet ta série à zéro.', '💰 4 bonnes réponses d’affilée = JACKPOT de 1 000 pts, + 20 pts par seconde restante !'],
    fourchette: ['Une question dont la réponse est un nombre ou une date.', 'Donne UNE seule valeur sur ton téléphone, il faut viser pile.', 'Le plus proche marque 200 pts, le 2e 100, le 3e 50, le 4e 25.', '🎯 Pile = +500 pts en bonus ! Ex æquo = mêmes points.'],
    champions: ['Les 2 meilleurs du classement s’affrontent au buzzer.', 'Les indices tombent un à un : buzze dès que tu as trouvé.', 'Raté ? Tu reprends la main dès que ton adversaire a répondu ou qu’un nouvel indice tombe.', 'Le premier à 3 ★ gagne la partie, quel que soit son score !'],
    duel: ['Buzze le premier et réponds juste pour frapper ton adversaire.', 'Une erreur te fait perdre de la vie.', 'Le premier K.O. a perdu !'],
  };
  Object.keys(RULES).forEach((k) => (PQA.ROUNDS[k].rules = RULES[k]));

  PQA.CARDS = {
    gel: { name: 'Gel', icon: '🧊', desc: 'Gèle le buzzer et les réponses d’un adversaire pendant 5 secondes.', target: true },
    inverse: { name: 'Miroir', icon: '🪞', desc: 'Les choix de l’adversaire s’affichent à l’envers et dans le désordre à la prochaine question.', target: true },
    vol: { name: 'Pickpocket', icon: '🦹', desc: 'Tu empoches la moitié des prochains points que gagne l’adversaire.', target: true },
    bombe: { name: 'Bombe', icon: '💣', desc: 'Si l’adversaire rate sa prochaine question, il perd 100 pts… et tu les gagnes. S’il trouve, la bombe est désamorcée.', target: true },
    bouclier: { name: 'Bouclier', icon: '🛡️', desc: 'Bloque la prochaine carte qu’on joue contre toi.', target: false },
  };

  PQA.shuffle = function (arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  PQA.vibrate = function (pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  };

  /** Empêche l'écran du téléphone de s'éteindre pendant la partie (si supporté). */
  PQA.keepAwake = async function () {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        PQA._wake = await navigator.wakeLock.request('screen');
      }
    } catch (e) {}
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && PQA._wantAwake) PQA.keepAwake();
  });

  /** Lien de base du site (marche aussi bien sur GitHub Pages qu'en local). */
  PQA.baseURL = function () {
    return location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  };
})();
