# 🎙️ Pixou IA : le relais du chat

Dans le chat de la partie, Pixou répond aux joueurs : quand on lui parle, il ne répond pas, il les clashe.
Sans configuration, il pioche dans des répliques toutes faites (`js/chat.js`).
Pour qu'il réponde vraiment à ce qui se dit, il lui faut une IA (Claude, d'Anthropic).

Le site est statique (GitHub Pages) : on ne peut pas y mettre de clé API, n'importe qui
pourrait la lire. Ce dossier contient donc un tout petit serveur gratuit, un **Cloudflare
Worker**, qui garde la clé secrète et appelle Claude à la place du navigateur.

```
Écran plateau (ou téléphone hôte)  ──►  Worker Cloudflare (clé secrète)  ──►  API Claude
```

Seul l'hôte appelle le relais, une fois par réplique de Pixou (il ne répond pas à chaque
message). Si le relais ne répond pas, le jeu repasse tout seul sur les répliques toutes faites.

## Mise en place (une fois, environ 10 minutes)

### 1. La clé API Claude

1. Crée un compte sur **https://console.anthropic.com** et ajoute un peu de crédit
   (*Billing*). 5 $ suffisent pour des milliers de répliques.
2. Dans *Settings → Limits*, fixe une **limite de dépense mensuelle** (par exemple 5 $) :
   c'est ta garantie que rien ne s'emballe.
3. Dans *API Keys*, crée une clé (`sk-ant-...`). Garde-la pour l'étape 2, ne la colle nulle
   part ailleurs (ni dans le code, ni dans un message).

### 2. Le Worker Cloudflare (gratuit)

Il faut [Node.js](https://nodejs.org/) et un compte gratuit sur **https://dash.cloudflare.com**.

```bash
cd worker/pixou
npm install
npx wrangler login                      # ouvre le navigateur pour se connecter à Cloudflare
npx wrangler secret put ANTHROPIC_API_KEY   # colle la clé quand c'est demandé
npx wrangler deploy
```

La dernière commande affiche l'adresse du relais, du type
`https://pixou-chat.<ton-compte>.workers.dev`.

*Sans terminal* : dans le tableau de bord Cloudflare, **Workers & Pages → Create →
Import a repository**, choisis ce dépôt avec le dossier racine `worker/pixou`, puis dans
**Settings → Variables and Secrets** ajoute le secret `ANTHROPIC_API_KEY`.

### 3. Brancher le jeu

Colle l'adresse du relais dans `js/chat.js` :

```js
const DEFAULT_AI_URL = 'https://pixou-chat.<ton-compte>.workers.dev';
```

Pour essayer avant de modifier le code, ajoute-la à l'adresse du plateau :
`host.html?pixou=https://pixou-chat.<ton-compte>.workers.dev` (elle est retenue par ce
navigateur ; `?pixou=off` l'oublie).

Dans le salon, la ligne **Chat** permet ensuite de choisir 🧠 Pixou IA, 🎲 Répliques ou 🤐 Pixou se tait.

## Réglages

Dans `wrangler.toml` :

| Variable | Rôle |
|---|---|
| `ALLOWED_ORIGINS` | Sites autorisés à appeler le relais (le réseau local l'est toujours). Si le jeu est hébergé ailleurs, ajoute son adresse. |
| `PIXOU_MODEL` | Modèle Claude. Par défaut `claude-opus-5-5`, le plus fin. `claude-haiku-5-5` est bien plus rapide et environ 40 fois moins cher, et suffit souvent pour des répliques courtes. |

## Garde-fous

- La clé n'est jamais envoyée aux téléphones ni écrite dans le dépôt.
- Le relais refuse les autres sites, limite chaque adresse IP à 20 répliques par minute,
  et coupe les messages trop longs.
- Pixou clashe les joueurs (vannes, petites insultes de cour de récré) mais reste tout public : il se moque du score et des messages, jamais de la personne elle-même, de ne jamais donner
  la réponse d'une question en cours, et de ne pas se laisser détourner par les joueurs.
- Les messages des joueurs sont filtrés par le jeu (insultes masquées, anti-flood) avant
  d'être affichés ou envoyés à l'IA ; la réplique de Pixou passe par le même filtre.
- La limite de dépense de la console Anthropic reste la protection ultime.
