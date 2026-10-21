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

- 🎡 **Thème Mystère** : la roue choisit le thème, chacun choisit son niveau de 1 à 10.
- 📏 **La Fourchette** : donne une seule valeur et vise pile. Réponse exacte = 400 pts, puis les points baissent avec l’écart (le plus proche gagne un bonus de 50 pts, trop loin = 0).
- 🔔 **Buzzer à indices** : les indices tombent un par un, plus tu buzzes tôt, plus tu gagnes.
  Mais attention : buzz raté = −100 points et exclu de la question, buzz pendant la lecture
  = faux départ (buzzer bloqué 2 s), et 5 secondes pour répondre (10 s s'il faut écrire).
- 4️⃣ **Le 4 à la suite** : 4 bonnes réponses d'affilée en 40 secondes.
- ⚡ **QCM éclair** : tout le monde répond en même temps, avec un bonus de rapidité.
- 🗃️ **Table des Savoirs** : cases à choisir à tour de rôle, avec pièges, doubles et vols.
- 🪜 **Finale : l'Échelle** : 10 paliers, jokers 50/50, vote du public et appel à un ami.

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
js/music.js     Musique chiptune générée (thème, une boucle par manche, suspense)
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

- **Musique** : composée par le jeu lui-même (chiptune 8-bit) : thème d'accueil, une boucle
  par manche, musique de suspense qui accélère avec le chrono, fanfare de victoire. Elle
  baisse automatiquement quand Pixou parle.
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

**1121 questions** en français, réparties en 16 catégories : Histoire, Actualité (2020-2026),
Géographie, Sciences & Nature, Cinéma & Séries, Musique, Sport, Littérature, Art & Architecture,
Gastronomie, Langue française, Insolite, Records & chiffres, Pop culture & jeux vidéo,
Inventions & tech, Personnalités.

Elles sont réparties en environ 45 % de QCM, 20 % de fourchettes, 15 % de questions à indices,
10 % de vrai/faux et 10 % de réponses libres. Chaque question a son anecdote.

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
