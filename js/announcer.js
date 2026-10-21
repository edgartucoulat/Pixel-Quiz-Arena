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
'Un nouveau candidat entre sur le plateau ! Le public est en délire.', 'Et un candidat de plus ! On sent déjà la tension monter.',       'Applaudissez {name} !', 'Voici {name}, qui a l’air très sûr de lui... trop sûr ?',
      '{name} entre sur le plateau ! Le public est en délire. Enfin, trois pixels sur quatre.',
      'Bienvenue {name} ! Tu as révisé ? Non ? Parfait.', '{name} nous rejoint. On sent déjà la tension monter !',
    ],
    rejoin: ['Un candidat revient parmi nous ! On avait gardé son score au chaud.', '{name} est de retour ! On avait gardé ton score au chaud.', 'Revoilà {name} ! Le téléphone faisait la sieste ?'],
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
    firstBuzz: ['Buzz ! Quelle rapidité !', 'Ça a buzzé ! Alors, cette réponse ?', 'Un buzz ! Je vous écoute.', '{name} buzze en premier !', 'Oh ! {name} a été le plus rapide !', 'Buzz de {name} ! Alors ?', '{name} tente sa chance !'],
    correct: ['Bonne réponse ! Bravo !', 'Exactement ! Quelle classe !', 'Bonne réponse ! Bravo {name} !', 'Exactement ! {name} empoche {pts} points.', 'Oui oui oui ! {name}, quelle classe !', 'Et c’est juste ! Le public est debout !', 'Bien joué {name}, tu m’impressionnes.'],
    correctMany: ['Plusieurs bonnes réponses ! Vous êtes trop forts, je vais devoir corser les questions.', '{n} bonnes réponses ! Vous êtes trop forts, je vais devoir corser les questions.', 'Bravo à vous {n} ! Les autres, on se réveille ?'],
    correctNone: ['Personne ! Absolument personne ! Je suis à la fois déçu et ravi.', 'Zéro bonne réponse. On dirait une soirée sans Wi-Fi.', 'Aïe aïe aïe, personne n’a trouvé...'],
    wrong: ['Faux ! Mais c’était une belle tentative.', 'Ah non, raté !', 'Faux ! Mais c’était une belle tentative, {name}.', 'Non non non ! {name}, tu étais si près... enfin, je crois.', 'Faux ! Le public est gêné pour toi.'],
    timeout: ['Temps écoulé !', 'Trop tard !', 'Le chrono a parlé !'],
    streak3: ['Trois bonnes réponses d’affilée ! Ça chauffe, multiplicateur fois deux !', '{name} est ON FIRE ! Trois bonnes réponses d’affilée, multiplicateur x2 !', 'Ça chauffe pour {name} ! Série de trois !'],
    streak5: ['Inarrêtable ! Appelez les pompiers, ça brûle !', 'Inarrêtable ! {name} enchaîne {n} bonnes réponses, multiplicateur x3 !', '{name} est en train de tout brûler ! Appelez les pompiers !'],
    teaseLast: ['Courage à notre lanterne rouge, la remontée, c’est maintenant !', '{last}, tu es dernier, mais je crois en toi. Un peu.', 'Courage {last}, la lanterne rouge, c’est joli aussi.', '{last} fait durer le suspense pour la remontée...'],
    leader: ['Nous avons un leader ! Mais rien n’est joué.', '{first} est en tête ! Mais rien n’est joué.', '{first} mène la danse. Qui va le faire tomber ?'],
    comeback: ['Quelle remontée ! Le public n’en revient pas !', 'Quelle remontée de {name} ! Le public n’en revient pas !', 'Incroyable, {name} grimpe au classement !'],
    anecdote: ['Le saviez-vous ? {text}', 'Petite anecdote : {text}', 'Pour briller en soirée : {text}'],
    wheel: ['La roue tourne... tourne...', 'Roue du destin, choisis le thème !'],
    wheelResult: ['La roue a parlé ! À toi de choisir ton niveau.', 'Ce sera {cat} pour {name} !', '{cat} ! {name}, à toi de choisir ton niveau.'],
    levelLow: ['On joue la sécurité ? Prudence de sioux !', 'Niveau {level}... on joue la sécurité, {name} ?', 'Niveau {level}, prudence de sioux !'],
    levelHigh: ['Un niveau très élevé ! Quel culot !', 'Niveau {level} ! {name} ne connaît pas la peur !', 'Wow, niveau {level} ! Quel culot !'],
    fourchetteSuspense: ['Voyons vos estimations... Roulement de tambour !', 'Qui a visé juste ? Suspense...'],
    fourchetteWin: ['Et nous avons un sniper ! Bravo au plus proche !', '{name} est le plus proche ! Un vrai sniper !', 'Précision chirurgicale pour {name} !'],
    fourchettePile: ['Pile ! Dans le mille ! Réponse exacte !', 'PILE ! {name} a trouvé la réponse exacte !', 'Dans le mille ! {name} tombe pile dessus !'],
    fourchetteNone: ['Personne n’est passé près de la bonne réponse ! Vous étiez tous à côté de la plaque.'],
    tablePick: ['À toi de choisir une case.', '{name}, à toi de choisir une case.', 'Quelle case pour {name} ?'],
    trap: ['Boum ! Case piégée ! Désolé... enfin, pas tant que ça.', 'BOUM ! Case piégée ! {name} perd {pts} points !', 'Aïe ! Un piège ! Désolé {name}... enfin, pas tant que ça.'],
    double: ['Case DOUBLE ! Ça vaut {pts} points, {name} !', 'Jackpot potentiel : points doublés !'],
    steal: ['Vol de points ! {name}, si tu réponds juste, tu les prends à quelqu’un !', 'Case voleuse ! Qui sera la victime ?'],
    ladderStep: ['Marche {n} ! On continue ?', 'Encore une marche de gagnée !', 'Et de {n} ! Le vertige commence ?'],
    ladderSafe: ['Palier assuré ! Ces points-là, personne ne te les enlèvera.'],
    ladderFail: ['Oh non ! La chute est terrible...', 'Patatras ! Fin de l’ascension.'],
    ladderStop: ['On s’arrête là. Sage décision... ou lâcheté ? Le public jugera.', '{name} s’arrête là. Sage décision... ou lâcheté ? Le public jugera.'],
    ladderTop: ['Au sommet ! Toute l’échelle a été gravie ! C’est historique !', 'AU SOMMET ! {name} a gravi toute l’échelle ! C’est historique !'],
    joker5050: ['50/50 ! Il ne reste plus que deux réponses.'],
    jokerPublic: ['Avis du public ! Les autres joueurs, votez sur vos téléphones !'],
    jokerFriend: ['Appel à un ami ! Trente secondes pour aider. Parlez !', 'Appel à un ami ! {name}, tu as 30 secondes pour aider. Parle !'],
    card_gel: ['Carte gel ! Le buzzer est congelé ! Ça caille !', '{name} gèle le buzzer de {target} ! Ça caille !'],
    card_inverse: ['Carte miroir ! Bonne lecture...', '{name} met {target} devant le miroir ! Bonne lecture...'],
    card_vol: ['Carte vol ! Les prochains points vont changer de poche ! Quel culot !', '{name} va voler les prochains points de {target} ! Quel culot !'],
    card_double: ['Carte double ! Les prochains points vaudront double !', '{name} active un DOUBLE ! Ses prochains points vaudront double !'],
    leaderboard: ['Petit point sur le classement !', 'Voyons qui mène la danse...', 'Classement provisoire ! Ça bouge !'],
    finalWinner: ['Notre grand vainqueur est sur la plus haute marche du podium ! Une ovation, s’il vous plaît !', 'Et le grand vainqueur de cette émission est... {name} ! Bravo !', 'Victoire de {name} ! Une ovation, s’il vous plaît !'],
    teamWinner: ['Et la victoire revient à cette équipe ! Quelle cohésion !', 'Victoire de l’équipe des {team} ! Quelle cohésion !'],
    duelHit: ['Coup critique !', 'Coup critique de {name} !', '{name} frappe fort !', 'Aïe, ça fait mal !'],
    duelKO: ['K.O. ! Le duel est terminé !', 'K.O. ! {name} remporte le duel !', 'C’est fini ! {name} est le champion du duel !'],
    presenterIRL: ['C’est à notre présentateur adoré de prendre le relais !'],
  };
  PQA.LINES = L;
  const recent = {};
  /** Choisit une réplique pour l'événement `key` et remplit les variables. */
  PQA.line = function (key, vars = {}) {
    const list = L[key];
    if (!list || !list.length) return '';
    // Sans voix naturelle pour dire les prénoms, on préfère les répliques enregistrées.
    const V = PQA.voice;
    const pool = V && V.preferRecorded ? list.filter((t) => V.has(t)) : [];
    const base = pool.length ? pool : list;
    const used = (recent[key] = recent[key] || []);
    let candidates = base.filter((t) => !used.includes(list.indexOf(t)));
    if (!candidates.length) { used.length = 0; candidates = base; }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    used.push(list.indexOf(pick));
    if (used.length > Math.max(1, list.length - 2)) used.shift();
    return pick.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
  };
})();
