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
    mystere: { name: 'Le Thème Mystère', short: 'Thème Mystère', icon: '🎡', desc: 'La roue choisit le thème, tu choisis ton niveau de 1 à 10. Plus c’est dur, plus ça rapporte !' },
    fourchette: { name: 'La Fourchette', short: 'Fourchette', icon: '📏', desc: 'Encadre la bonne réponse avec tes deux curseurs. La fourchette la plus serrée rafle la mise.' },
    indices: { name: 'Le Buzzer à indices', short: 'Indices', icon: '🔔', desc: 'Les indices tombent un à un. Buzze dès que tu sais : plus tu es rapide, plus tu gagnes.' },
    quatre: { name: 'Le 4 à la suite', short: '4 à la suite', icon: '4️⃣', desc: 'Choisis ton thème et enchaîne 4 bonnes réponses d’affilée en 40 secondes. Une erreur et tout repart à zéro !' },
    eclair: { name: 'Tous en même temps', short: 'QCM éclair', icon: '⚡', desc: 'Tout le monde répond en même temps. Bonus de rapidité pour les plus vifs.' },
    table: { name: 'La Table des Savoirs', short: 'Table des Savoirs', icon: '🗃️', desc: 'Choisis une case à tour de rôle. Attention aux pièges, aux cases doubles et aux vols de points !' },
    echelle: { name: 'Finale : L’Échelle', short: 'L’Échelle', icon: '🪜', desc: 'Le leader grimpe 10 paliers de plus en plus durs, avec trois jokers pour s’en sortir.' },
    duel: { name: 'Duel', short: 'Duel', icon: '🥊', desc: 'Chaque bonne réponse inflige des dégâts à l’adversaire. Premier K.O. perdu !' },
  };

  PQA.CARDS = {
    gel: { name: 'Gel', icon: '🧊', desc: 'Gèle le buzzer et les réponses d’un adversaire pendant 5 secondes.', target: true },
    inverse: { name: 'Miroir', icon: '🪞', desc: 'Les choix de l’adversaire s’affichent à l’envers et dans le désordre à la prochaine question.', target: true },
    vol: { name: 'Vol de question', icon: '🦹', desc: 'Les prochains points gagnés par l’adversaire sont pour toi.', target: true },
    double: { name: 'Double', icon: '✖️2', desc: 'Tes prochains points gagnés sont doublés.', target: false },
  };

  PQA.LADDER = [50, 100, 150, 200, 300, 400, 500, 650, 800, 1000];
  PQA.LADDER_SAFE = 4; // index du palier assuré (5e marche)

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
