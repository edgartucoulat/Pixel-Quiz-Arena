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
| 🤖 **Présentateur virtuel** | Pixou, le présentateur en pixel art, anime la partie (bulles de texte, voix de synthèse en option). |
| 🎤 **Présentateur IRL** | Un humain présente avec la **télécommande** (`presenter.html`, QR code sur le plateau) : il voit la réponse et l'anecdote, valide ou refuse les réponses orales, donne des points. |
| 🥊 **Duel 1 contre 1** | Barres de vie : chaque bonne réponse inflige des dégâts. Jouable aussi **sur un seul écran** au clavier (touches **A** et **L** pour buzzer). |
| 👥 **Équipes** | 2 à 4 équipes, scores cumulés. |

### Les manches

- 🎡 **Thème Mystère** : la roue choisit le thème, chacun choisit son niveau de 1 à 10.
- 📏 **La Fourchette** : encadre la réponse avec deux curseurs, la fourchette la plus serrée gagne.
- 🔔 **Buzzer à indices** : les indices tombent un par un, plus tu buzzes tôt, plus tu gagnes.
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
  le jeu bascule automatiquement sur un broker MQTT public (EMQX, HiveMQ ou Mosquitto).
  Les messages y passent en clair, ce qui est acceptable pour une partie entre amis.
- Une connexion internet est donc nécessaire, même si tout le monde est dans la même pièce.

```
host.html       Écran Plateau (le "serveur" de la partie)
play.html       Manette joueur (mobile)
presenter.html  Télécommande du présentateur IRL
js/engine.js    Moteur de jeu : manches, scores, règles
js/host-ui.js   Rendu du plateau, animations, sons
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
- **Le téléphone affiche « Salle introuvable »** : vérifie le code, et que le plateau est bien ouvert.
- **Pas de son** : les navigateurs exigent un clic avant de jouer du son. Clique sur le plateau,
  et vérifie le bouton 🔊 en haut à droite.

---

## Les questions

**1007 questions** en français, réparties en 16 catégories : Histoire, Actualité (2020-2026),
Géographie, Sciences & Nature, Cinéma & Séries, Musique, Sport, Littérature, Art & Architecture,
Gastronomie, Langue française, Insolite, Records & chiffres, Pop culture & jeux vidéo,
Inventions & tech, Personnalités.

Elles sont réparties en environ 45 % de QCM, 20 % de fourchettes, 15 % de questions à indices,
10 % de vrai/faux et 10 % de réponses libres. Côté difficulté, environ 20 % sont faciles,
50 % moyennes et 30 % difficiles. Chaque question a son anecdote.

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
  "difficulte": 5,                 // 1 (facile) à 10 (très dur)
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
| `fourchette` | `reponse` numérique, `unite` (`"année"` pour une date, négatif = av. J.-C.), `tolerance`, `bornes` : `[min, max]` des curseurs |
| `indices` | `indices` : 3 à 5 indices du plus dur au plus facile, `reponses_acceptees` |
| `libre` | `reponses_acceptees` : variantes acceptées (les accents, articles et petites fautes sont tolérés automatiquement) |

Pour une nouvelle catégorie, ajoute-la aussi dans `data/questions/index.json`.

---

Licence MIT. Polices Press Start 2P et VT323 (Google Fonts, licence OFL). PeerJS (MIT) et
qrcode-generator (MIT) sont inclus dans `js/vendor/`.
