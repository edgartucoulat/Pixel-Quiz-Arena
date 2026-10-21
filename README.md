# 🎮 PIXEL QUIZ ARENA

Jeu télé rétro de culture générale, en pixel art 16 bits, multijoueur en temps réel.
Un écran (TV, vidéoprojecteur, ordinateur) sert de **plateau**, et chaque joueur joue
avec **son téléphone** comme manette. Pas de compte, pas d'installation, pas de serveur
à payer : c'est un site statique, gratuit, hébergé sur GitHub Pages.

👉 **Jouer : https://edgartucoulat.github.io/Pixel-Quiz-Arena/**

---

## Comment jouer

1. Sur l'écran principal (TV, PC, vidéoprojecteur), ouvre
   **https://edgartucoulat.github.io/Pixel-Quiz-Arena/host.html** puis clique sur
   **« Ouvrir le plateau »**. Touche **F** pour le plein écran.
2. Les joueurs (2 à 10) scannent le **QR code** avec leur téléphone, ou vont sur
   `…/play.html` et tapent le **code à 4 lettres**. Chacun choisit son pseudo et son avatar.
3. Sur le plateau, choisis le mode, les manches, la durée, puis **« Lancer l'émission »**.

Si un téléphone se met en veille ou perd le réseau, il se reconnecte tout seul et garde
son score. Si le plateau est rechargé, il propose de **reprendre la partie**.

### Les modes

| Mode | Principe |
|---|---|
| 🤖 **Présentateur virtuel** | Pixou, le présentateur en pixel art, anime la partie (bulles de texte et voix naturelle, voir [Son et voix](#son-et-voix)). |
| 🎤 **Présentateur IRL** | Un humain présente avec la **télécommande** (`presenter.html`, QR code sur le plateau) : il voit la réponse et l'anecdote, valide ou refuse les réponses orales, donne des points. |
| 🥊 **Duel 1 contre 1** | Barres de vie : chaque bonne réponse inflige des dégâts. Jouable aussi **sur un seul écran** au clavier (touches **A** et **L** pour buzzer). |
| 👥 **Équipes** | 2 à 4 équipes, scores cumulés. |

### Les manches

Par défaut, l'émission enchaîne dans cet ordre :

1. 🏁 **Le Sprint** : 10 questions au buzzer sur des thèmes tirés au hasard. Pas de choix
   multiple : on buzze, puis on tape sa réponse (à l'oral en mode présentateur IRL).
   Bonne réponse = 200 pts. Attention : buzz raté = −100 points et exclu de la question,
   buzz pendant la lecture = faux départ (buzzer bloqué 2 s), et 10 secondes pour répondre.
2. 🎁 **Les Cases mystères** : chacun choisit une case à tour de rôle. Le thème et la valeur
   (100 à 400 pts) restent cachés jusqu'au choix, avec des pièges, des cases doubles et des vols.
3. 4️⃣ **Le 4 à la suite** : le 1er du classement choisit son thème en premier, puis le 2e, etc.
   Un thème pris n'est plus disponible pour les suivants ; le « thème mystère » en tire un
   au hasard. Il faut enchaîner 4 bonnes réponses d'affilée en 40 secondes.
4. 📏 **La Fourchette** : donne une seule valeur et vise pile. Réponse exacte = 400 pts, puis les points baissent avec l’écart (le plus proche gagne un bonus de 50 pts, trop loin = 0).
5. ⚔️ **Le Duel des champions** (toujours en dernier) : les 2 meilleurs du classement
   s'affrontent au buzzer à indices, les indices tombant un à un. Le premier à 3 bonnes
   réponses **gagne la partie**, quel que soit son score (en équipes, son équipe gagne).

En option dans le salon : 🎡 **Thème Mystère** (la roue choisit le thème, chacun choisit son
niveau de 1 à 10) et ⚡ **QCM éclair** (tout le monde répond en même temps, bonus de rapidité).

Et aussi : combos « ON FIRE » (x2, x3), cartes « coup bas » (gel, miroir, vol, double),
anecdotes après chaque question, titres humoristiques en fin de partie. Les questions déjà
vues sont mémorisées par le navigateur du plateau, pour ne pas retomber dessus.

### Raccourcis clavier du plateau

| Touche | Action |
|---|---|
| Espace / Entrée | Passer à la suite |
| P | Pause |
| F | Plein écran |
| A / L | Buzzer des joueurs en duel local |
| 1-4 ou Q W E R / 7-0 ou U I O P | Réponses des joueurs en duel local |

---

## Comment ça marche (technique)

- **100 % statique** : HTML, CSS et JavaScript, sans framework ni étape de build.
- **Le plateau est le serveur** : `host.html` fait autorité sur les chronos, l'ordre des
  buzz (avec compensation de la latence), les scores et la validation. Les téléphones
  envoient seulement leurs actions et affichent ce que le plateau leur dit.
- **Réseau** : connexion directe WebRTC avec [PeerJS](https://peerjs.com/), via le
  serveur gratuit `0.peerjs.com`.
  **Relais de secours** : si ce serveur est injoignable (réseau d'entreprise, pare-feu…),
  ou si la liaison directe est bloquée, le jeu bascule automatiquement sur un relais :
  le serveur PeerJS lui-même (port 443, le plus souvent autorisé) ou un broker MQTT public
  (EMQX, HiveMQ ou Mosquitto). Les messages y passent en clair, ce qui est acceptable pour
  une partie entre amis.
- Une connexion internet est donc nécessaire, même si tout le monde est dans la même pièce.

```
host.html       Écran Plateau (le "serveur" de la partie)
play.html       Manette joueur (mobile)
presenter.html  Télécommande du présentateur IRL
js/engine.js    Moteur de jeu : manches, scores, règles
js/host-ui.js   Rendu du plateau, animations, sons
js/audio.js     Effets sonores 8-bit synthétisés (buzzers, public, tambour…)
js/music.js     Lecteur de musique (ambiances en boucle, jingles, suspense)
audio/music/    Musiques originales (générées par scripts/compose_music.py)
js/voice.js     Voix du présentateur (enregistrements + voix naturelles du navigateur)
audio/voice/    Voix enregistrée, générée automatiquement (ne pas modifier à la main)
js/net.js       Réseau PeerJS + reconnexion automatique
js/relay.js     Relais de secours MQTT (client minimal sans dépendance)
data/questions/ Banque de questions (un fichier JSON par catégorie)
scripts/        Outils de développement (serveur local, validation des questions)
```

---

## Mettre en ligne sur GitHub Pages

1. Sur GitHub, ouvre le dépôt puis **Settings → Pages**.
2. **Source : Deploy from a branch**, branche **`main`**, dossier **`/ (root)`**, puis **Save**.
3. Une à deux minutes plus tard, le jeu est en ligne sur
   `https://<utilisateur>.github.io/Pixel-Quiz-Arena/`.

Chaque modification fusionnée dans `main` est publiée automatiquement. Après une mise à
jour, recharge la page du plateau avec **Ctrl+F5** pour vider le cache.

## Tester en local

Il faut [Node.js](https://nodejs.org/) (aucune dépendance à installer) :

```bash
npm start          # ou : node scripts/serve.js 8080
```

Le script affiche les adresses à ouvrir : `http://localhost:8080/host.html` sur l'ordinateur
et `http://<IP-locale>:8080/play.html` sur les téléphones connectés au même Wi-Fi.
Ouvrir les fichiers en double-cliquant dessus ne marche pas : il faut passer par un serveur web.
(`npx serve` fonctionne aussi.)

Options d'URL utiles pour le développement :

| Paramètre | Effet |
|---|---|
| `?transport=relay` | Force le relais MQTT (à ajouter sur le plateau et les téléphones) |
| `?relay=ws://hote:port` | Utilise un broker MQTT perso |
| `?peer=hote:port&peersecure=0` | Utilise un serveur PeerJS perso |

## Problèmes fréquents

- **« Connexion au serveur de mise en relation impossible »** : le navigateur n'arrive à
  joindre ni PeerJS ni le relais. C'est fréquent sur un **ordinateur professionnel** (logiciel
  de sécurité ou proxy). Utilise un ordinateur personnel ou le navigateur d'une TV.
- **Le téléphone reste sur « Connexion au plateau »** : regarde la ligne « Réseau » sur le
  plateau et le texte sous le bandeau orange du téléphone. Il faut qu'au moins un canal soit
  marqué ✔ des deux côtés.
- **Le téléphone affiche « Salle introuvable »** : vérifie le code, et que le plateau est bien ouvert.
- **Pas de son** : les navigateurs exigent un clic avant de jouer du son. Clique sur le plateau,
  et vérifie les boutons 🔊 Son et 🎚️ Réglages en haut à droite.

---

## Son et voix

Tout est gratuit et sans serveur. Le bouton **🎚️ Réglages** du plateau règle séparément la
**musique**, les **effets** et la **voix**, et indique quelle voix est utilisée.

- **Musique** : des compositions originales jouées par de vrais instruments (orchestre,
  cuivres, piano, timbales) : ambiance lounge à l'accueil, trois fonds discrets pendant les
  manches, musique de réflexion qui se tend quand le chrono s'épuise, un **jingle d'annonce
  différent pour chaque manche**, fanfares d'ouverture et de victoire. Elle baisse
  automatiquement quand Pixou parle.
  Les partitions sont écrites dans `scripts/compose_music.py` et jouées avec la banque de
  sons libre **FluidR3_GM** (Frank Wen, licence MIT) :
  `pip install mido && python3 scripts/compose_music.py` (fluidsynth, ffmpeg et le paquet
  `fluid-soundfont-gm` requis). Aucune musique d'un tiers n'est utilisée.
- **Effets** : un buzzer différent par joueur, faux départ, roulement de tambour,
  applaudissements, « ooooh » déçu et « wouah » du public.
- **Voix de Pixou** : pour éviter l'effet robot, deux sources sont combinées.
  1. **Une voix neuronale enregistrée** (`audio/voice/`) : répliques, questions, indices et
     anecdotes sont pré-enregistrés avec la voix *Rémy* de Microsoft (gratuite, via
     [edge-tts](https://github.com/rany2/edge-tts)), compressés en Opus. L'action GitHub
     **« Voix du présentateur »** (`.github/workflows/voice.yml`) ré-enregistre
     automatiquement ce qui change à chaque modification des questions ou des répliques.
     On peut aussi la lancer à la main depuis l'onglet *Actions*, ou en local :
     `pip install edge-tts && python3 scripts/gen_voice.py` (ffmpeg requis).
  2. **Les voix naturelles du navigateur**, pour ce qui ne peut pas être enregistré (les
     pseudos des joueurs). **Microsoft Edge** fournit gratuitement les mêmes voix neuronales
     (« Microsoft Rémy/Henri Online (Natural) ») : c'est le navigateur conseillé pour le
     plateau. Sur les autres navigateurs, Pixou s'en tient aux phrases enregistrées.

  Les voix système robotiques ne sont jamais utilisées, sauf si l'on coche
  « Voix robotique en secours ».

---

## Les questions

**1515 questions** en français, réparties en 16 catégories : Histoire, Actualité (2020-2026),
Géographie, Sciences & Nature, Cinéma & Séries, Musique, Sport, Littérature, Art & Architecture,
Gastronomie, Langue française, Insolite, Records & chiffres, Pop culture & jeux vidéo,
Inventions & tech, Personnalités.

Elles sont réparties en environ 34 % de QCM, 17 % de fourchettes, 13 % de questions à indices,
9 % de vrai/faux et 26 % de réponses libres, à taper (avec leurs variantes acceptées).
Chaque question a son anecdote.

Échelle de difficulté (il n'y a plus de questions de niveau 1, jugées trop évidentes) :

| Niveau | Pour qui |
|---|---|
| 2-3 | Culture générale courante |
| 4-5 | Bonne culture générale |
| 6-7 | Amateur éclairé |
| 8-9 | Connaisseur, spécialiste |
| 10 | Expert : très pointu, même pour un passionné |

### Vérifier la banque

```bash
npm run validate          # ou : node scripts/validate-questions.js -v  (affiche aussi les avertissements)
```

Le script vérifie le format de chaque question, repère les doublons et les questions très
proches, et affiche les statistiques par catégorie, type et difficulté. Il renvoie une erreur
si quelque chose ne va pas.

### Ajouter des questions

Ajoute un objet dans le fichier de la catégorie (`data/questions/<categorie>.json`), avec un
`id` unique, puis lance `npm run validate`. Champs communs :

```jsonc
{
  "id": "his-101",                 // préfixe de la catégorie + numéro
  "categorie": "Histoire",         // nom exact de la catégorie (voir index.json)
  "sous_theme": "Moyen Âge",
  "type": "qcm",                   // qcm | vf | fourchette | indices | libre
  "difficulte": 5,                 // 2 (culture courante) à 10 (expert)
  "question": "…",
  "reponse": "…",
  "anecdote": "…",                 // affichée après la réponse
  "annee_reference": 2024,         // conseillé pour l'actualité
  "tags": ["…"]                    // facultatif
}
```

Selon le type :

| Type | Champs en plus |
|---|---|
| `qcm` | `choix` : 4 propositions distinctes, dont la `reponse` |
| `vf` | `reponse` : `"Vrai"` ou `"Faux"` |
| `fourchette` | `reponse` numérique, `unite` (`"année"` pour une date, négatif = av. J.-C.), `tolerance` (écart encore compté « pile », plafonné à 2 % de la réponse), `bornes` : `[min, max]` du curseur, qui servent aussi d’échelle pour noter l’écart |
| `indices` | `indices` : 3 à 5 indices du plus dur au plus facile, `reponses_acceptees` |
| `libre` | `reponses_acceptees` : variantes acceptées (les accents, articles et petites fautes sont tolérés automatiquement) |

Pour une nouvelle catégorie, ajoute-la aussi dans `data/questions/index.json`.

---

Licence MIT. Polices Press Start 2P et VT323 (Google Fonts, licence OFL). PeerJS (MIT) et
qrcode-generator (MIT) sont inclus dans `js/vendor/`.
