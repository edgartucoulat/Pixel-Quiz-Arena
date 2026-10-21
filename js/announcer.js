/* =========================================================================
 * PIXEL QUIZ ARENA - Répliques du présentateur virtuel "Pixou"
 * Chaque événement a plusieurs répliques ; on évite de répéter les dernières.
 * Variables : {name} {pts} {last} {first} {n} {cat} {level} {team} ...
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  const L = {
    welcome: [
      'Bonsoir bonsoir ! Bienvenue dans PIXEL QUIZ ARENA, le seul jeu télé où le public est fait de pixels !',
      'Mesdames, messieurs, et toi au fond qui fais semblant de ne pas regarder... bienvenue dans PIXEL QUIZ ARENA !',
      'Lumières ! Musique ! Candidats nerveux ! C’est parti pour PIXEL QUIZ ARENA !',
    ],
    lobbyIdle: [
      'Scannez le QR code, choisissez un pseudo ridicule et rejoignez-moi sur le plateau !',
      'J’attends les candidats... Mon brushing ne va pas tenir éternellement.',
      'Allez, tout le monde sort son téléphone. Pour une fois, c’est autorisé !',
    ],
    join: [
      'Applaudissez {name} !', 'Voici {name}, qui a l’air très sûr de lui... trop sûr ?',
      '{name} entre sur le plateau ! Le public est en délire. Enfin, trois pixels sur quatre.',
      'Bienvenue {name} ! Tu as révisé ? Non ? Parfait.', '{name} nous rejoint. On sent déjà la tension monter !',
    ],
    rejoin: ['{name} est de retour ! On avait gardé ton score au chaud.', 'Revoilà {name} ! Le téléphone faisait la sieste ?'],
    start: [
      'Que l’émission commence ! Que le meilleur gagne, et que les autres trouvent une bonne excuse.',
      'Candidats, prenez vos téléphones. On ne rigole plus. Enfin si, un peu.',
    ],
    round_mystere: ['Première épreuve : le Thème Mystère ! La roue décide du thème, vous décidez du niveau. Courage ou prudence ?', 'Place à la roue du destin ! Choisissez bien votre niveau...'],
    round_fourchette: ['La Fourchette ! Un seul chiffre, et il faut viser pile. Plus vous êtes près, plus ça paie !', 'À vos curseurs ! C’est l’heure de la Fourchette, l’épreuve des estimateurs fous : visez juste !'],
    round_indices: ['Le Buzzer à indices ! Les indices arrivent un par un. Buzzez trop tôt et c’est la honte, trop tard et c’est la défaite.', 'Doigts sur les buzzers ! Plus vous buzzez tôt, plus ça rapporte.'],
    round_quatre: ['Le 4 à la suite ! Quarante secondes, quatre bonnes réponses d’affilée. Une erreur et on repart de zéro !'],
    round_eclair: ['Tous en même temps ! Répondez vite, répondez juste : la rapidité rapporte des bonus.', 'QCM éclair ! Le premier qui réfléchit trop longtemps a perdu.'],
    round_table: ['La Table des Savoirs ! Des cases, des thèmes, et quelques pièges bien vicieux...', 'Choisissez vos cases avec soin : certaines explosent, d’autres doublent la mise !'],
    round_echelle: ['C’est la grande finale : l’Échelle ! Dix marches vers la gloire, et trois jokers pour ne pas tomber.', 'La finale ! {name}, vous avez le vertige ?'],
    round_duel: ['Mesdames et messieurs, un DUEL ! Chaque bonne réponse fait mal. Très mal.', 'Round 1... FIGHT ! Que le cerveau le plus affûté gagne !'],
    question: ['Question suivante !', 'Attention, écoutez bien...', 'Celle-là, je l’adore.', 'Accrochez-vous.', 'On continue !', 'Facile... ou pas !', 'Je vous préviens : il y a un piège. Ou pas.'],
    hardQuestion: ['Ouh, celle-là est corsée...', 'Niveau expert ! Même moi je ne connaissais pas la réponse. J’ai triché.', 'Question de champion, attention !'],
    easyQuestion: ['Allez, une facile pour se détendre.', 'Celle-là, si vous la ratez, je ne peux plus rien pour vous.'],
    firstBuzz: ['{name} buzze en premier !', 'Oh ! {name} a été le plus rapide !', 'Buzz de {name} ! Alors ?', '{name} tente sa chance !'],
    correct: ['Bonne réponse ! Bravo {name} !', 'Exactement ! {name} empoche {pts} points.', 'Oui oui oui ! {name}, quelle classe !', 'Et c’est juste ! Le public est debout !', 'Bien joué {name}, tu m’impressionnes.'],
    correctMany: ['{n} bonnes réponses ! Vous êtes trop forts, je vais devoir corser les questions.', 'Bravo à vous {n} ! Les autres, on se réveille ?'],
    correctNone: ['Personne ! Absolument personne ! Je suis à la fois déçu et ravi.', 'Zéro bonne réponse. On dirait une soirée sans Wi-Fi.', 'Aïe aïe aïe, personne n’a trouvé...'],
    wrong: ['Ah non, raté !', 'Faux ! Mais c’était une belle tentative, {name}.', 'Non non non ! {name}, tu étais si près... enfin, je crois.', 'Faux ! Le public est gêné pour toi.'],
    timeout: ['Temps écoulé !', 'Trop tard !', 'Le chrono a parlé !'],
    streak3: ['{name} est ON FIRE ! Trois bonnes réponses d’affilée, multiplicateur x2 !', 'Ça chauffe pour {name} ! Série de trois !'],
    streak5: ['Inarrêtable ! {name} enchaîne {n} bonnes réponses, multiplicateur x3 !', '{name} est en train de tout brûler ! Appelez les pompiers !'],
    teaseLast: ['{last}, tu es dernier, mais je crois en toi. Un peu.', 'Courage {last}, la lanterne rouge, c’est joli aussi.', '{last} fait durer le suspense pour la remontée...'],
    leader: ['{first} est en tête ! Mais rien n’est joué.', '{first} mène la danse. Qui va le faire tomber ?'],
    comeback: ['Quelle remontée de {name} ! Le public n’en revient pas !', 'Incroyable, {name} grimpe au classement !'],
    anecdote: ['Le saviez-vous ? {text}', 'Petite anecdote : {text}', 'Pour briller en soirée : {text}'],
    wheel: ['La roue tourne... tourne...', 'Roue du destin, choisis le thème !'],
    wheelResult: ['Ce sera {cat} pour {name} !', '{cat} ! {name}, à toi de choisir ton niveau.'],
    levelLow: ['Niveau {level}... on joue la sécurité, {name} ?', 'Niveau {level}, prudence de sioux !'],
    levelHigh: ['Niveau {level} ! {name} ne connaît pas la peur !', 'Wow, niveau {level} ! Quel culot !'],
    fourchetteSuspense: ['Voyons vos estimations... Roulement de tambour !', 'Qui a visé juste ? Suspense...'],
    fourchetteWin: ['{name} est le plus proche ! Un vrai sniper !', 'Précision chirurgicale pour {name} !'],
    fourchettePile: ['PILE ! {name} a trouvé la réponse exacte !', 'Dans le mille ! {name} tombe pile dessus !'],
    fourchetteNone: ['Personne n’est passé près de la bonne réponse ! Vous étiez tous à côté de la plaque.'],
    tablePick: ['{name}, à toi de choisir une case.', 'Quelle case pour {name} ?'],
    trap: ['BOUM ! Case piégée ! {name} perd {pts} points !', 'Aïe ! Un piège ! Désolé {name}... enfin, pas tant que ça.'],
    double: ['Case DOUBLE ! Ça vaut {pts} points, {name} !', 'Jackpot potentiel : points doublés !'],
    steal: ['Vol de points ! {name}, si tu réponds juste, tu les prends à quelqu’un !', 'Case voleuse ! Qui sera la victime ?'],
    ladderStep: ['Marche {n} ! On continue ?', 'Encore une marche de gagnée !', 'Et de {n} ! Le vertige commence ?'],
    ladderSafe: ['Palier assuré ! Ces points-là, personne ne te les enlèvera.'],
    ladderFail: ['Oh non ! La chute est terrible...', 'Patatras ! Fin de l’ascension.'],
    ladderStop: ['{name} s’arrête là. Sage décision... ou lâcheté ? Le public jugera.'],
    ladderTop: ['AU SOMMET ! {name} a gravi toute l’échelle ! C’est historique !'],
    joker5050: ['50/50 ! Il ne reste plus que deux réponses.'],
    jokerPublic: ['Avis du public ! Les autres joueurs, votez sur vos téléphones !'],
    jokerFriend: ['Appel à un ami ! {name}, tu as 30 secondes pour aider. Parle !'],
    card_gel: ['{name} gèle le buzzer de {target} ! Ça caille !'],
    card_inverse: ['{name} met {target} devant le miroir ! Bonne lecture...'],
    card_vol: ['{name} va voler les prochains points de {target} ! Quel culot !'],
    card_double: ['{name} active un DOUBLE ! Ses prochains points vaudront double !'],
    leaderboard: ['Petit point sur le classement !', 'Voyons qui mène la danse...', 'Classement provisoire ! Ça bouge !'],
    finalWinner: ['Et le grand vainqueur de cette émission est... {name} ! Bravo !', 'Victoire de {name} ! Une ovation, s’il vous plaît !'],
    teamWinner: ['Victoire de l’équipe des {team} ! Quelle cohésion !'],
    duelHit: ['Coup critique de {name} !', '{name} frappe fort !', 'Aïe, ça fait mal !'],
    duelKO: ['K.O. ! {name} remporte le duel !', 'C’est fini ! {name} est le champion du duel !'],
    presenterIRL: ['C’est à notre présentateur adoré de prendre le relais !'],
  };

  const recent = {};
  /** Choisit une réplique pour l'événement `key` et remplit les variables. */
  PQA.line = function (key, vars = {}) {
    const list = L[key];
    if (!list || !list.length) return '';
    const used = (recent[key] = recent[key] || []);
    let candidates = list.filter((_, i) => !used.includes(i));
    if (!candidates.length) { used.length = 0; candidates = list; }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    used.push(list.indexOf(pick));
    if (used.length > Math.max(1, list.length - 2)) used.shift();
    return pick.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  };

  /* ---- Synthèse vocale (Web Speech API), optionnelle ------------------- */
  PQA.tts = {
    enabled: false,
    voice: null,
    init() {
      if (!('speechSynthesis' in window)) return;
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        this.voice = voices.find((v) => /fr[-_]FR/i.test(v.lang) && /google|thomas|paul|daniel/i.test(v.name))
          || voices.find((v) => /^fr/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    },
    speak(text) {
      if (!this.enabled || !('speechSynthesis' in window) || !text) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*_]/g, ''));
      u.lang = 'fr-FR';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.05; u.pitch = 1.1;
      speechSynthesis.speak(u);
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
  };
})();
