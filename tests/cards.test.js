'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
/** Comparaison entre contextes vm (les tableaux du moteur ne sont pas ceux du test). */
const eq = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);

const CATS = [{ name: 'Sport', icon: '⚽' }, { name: 'Histoire', icon: '📜' }];
const BANK = [];
for (const cat of CATS) {
  for (let i = 0; i < 6; i++) BANK.push({ id: cat.name + i, categorie: cat.name, type: 'libre', difficulte: 3 + i, question: cat.name + ' ' + i + ' ?', reponse: 'R' + cat.name + i });
  BANK.push({ id: cat.name + 'ind', categorie: cat.name, type: 'indices', difficulte: 4, question: 'Qui suis-je ?', indices: ['a', 'b', 'c'], reponse: 'Ind' + cat.name });
}

/** Une vraie partie (sans écran) avec les joueurs a, b, c, d. */
function game(settings = {}) {
  const clock = { t: 1000 };
  const s = {
    window: {}, performance: { now: () => clock.t }, Math, console, setInterval: () => 0,
    document: { addEventListener() {} }, navigator: {},
  };
  for (const file of ['common', 'voice', 'announcer', 'chat', 'engine']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), s);
  const PQA = s.window.PQA;
  const sent = [];
  const g = new PQA.Game(BANK.map((q) => ({ ...q })), CATS, { changed() {}, fx() {}, say() {}, send: (pid, m) => sent.push({ pid, m }) });
  Object.assign(g.settings, { rounds: ['sprint', 'champions'], pixou: 'off' }, settings);
  for (const id of ['a', 'b', 'c', 'd']) {
    g.players[id] = { id, name: id.toUpperCase(), score: 0, streak: 0, bestStreak: 0, cards: [], frozenUntil: 0, connected: true, team: 0, rtt: 0,
      stats: { correct: 0, wrong: 0, answered: 0, buzzWins: 0, wrongBuzz: 0, fastest: null, fourchette: 0, cardsUsed: 0, hardCorrect: 0, worstRank: 1, points: 0 } };
    g.order.push(id);
  }
  return { g, PQA, clock, sent };
}

test('every player starts with one Gel and one Question piégée', () => {
  const { g } = game();
  assert.equal(g.start(), null);
  for (const p of g.activePlayers()) eq(p.cards, ['gel', 'piege']);
});

test('no cards when « Coups bas » is off, nor in duel mode', () => {
  const off = game({ cards: false }).g;
  off.start();
  eq(off.players.a.cards, []);
  const duel = game({ mode: 'duel' }).g;
  delete duel.players.c; delete duel.players.d; duel.order = ['a', 'b'];
  duel.start();
  eq(duel.players.a.cards, []);
});

test('only Gel and Question piégée exist', () => {
  const { PQA } = game();
  eq(Object.keys(PQA.CARDS), ['gel', 'piege']);
});

test('each card is single use, and nobody earns new ones by answering', () => {
  const { g } = game();
  g.start();
  g.useCard('a', 'gel', 'b');
  assert.ok(g.isFrozen(g.players.b));
  g.players.b.frozenUntil = 0;
  g.useCard('a', 'gel', 'b');
  assert.equal(g.isFrozen(g.players.b), 0);
  eq(g.players.a.cards, ['piege']);
  for (let i = 0; i < 8; i++) g.scoreCorrect(g.players.a, 100);
  eq(g.players.a.cards, ['piege']);
});

test('Question piégée: needs a target other than yourself and a real theme', () => {
  const { g } = game();
  g.start();
  g.useCard('a', 'piege', 'a', 'Sport');
  g.useCard('a', 'piege', 'b', 'Cuisine imaginaire');
  eq(g.traps, []);
  g.useCard('a', 'piege', 'b', 'Histoire');
  eq(g.traps, [{ from: 'a', target: 'b', cat: 'Histoire' }]);
  eq(g.players.a.cards, ['gel']);
});

test('Question piégée is played after the current question, then the round goes on', () => {
  const { g } = game();
  g.start();
  g.beginRound();
  const sprintQ = g.q;
  const before = g.round.n;
  g.useCard('a', 'piege', 'b', 'Histoire');
  g.reveal();
  g.afterReveal();
  assert.equal(g.phase, 'trap');
  g.advance();
  assert.equal(g.phase, 'question');
  assert.notEqual(g.q, sprintQ);
  eq(g.q.answerers, ['b']);
  assert.equal(g.q.data.categorie, 'Histoire');
  assert.ok(Math.abs(g.q.data.difficulte - 5) <= 1, 'niveau moyen');
  g.answer('b', g.q.data.reponse);
  assert.equal(g.players.b.score, 300);
  g.afterReveal();
  assert.equal(g.round.type, 'sprint');
  assert.equal(g.round.n, before + 1, 'le Sprint reprend à la question suivante');
  assert.equal(g.q.kind, 'buzz');
});

test('Question piégée: −200 for a wrong answer or no answer', () => {
  const { g } = game();
  g.start();
  g.beginRound();
  g.useCard('a', 'piege', 'b', 'Sport');
  g.useCard('c', 'piege', 'd', 'Sport');
  g.reveal();
  g.afterReveal();
  g.advance();
  g.answer('b', 'pas du tout');
  assert.equal(g.players.b.score, -200);
  g.afterReveal();
  assert.equal(g.phase, 'trap', 'le deuxième piège suit');
  g.advance();
  g.reveal(); // temps écoulé sans réponse
  assert.equal(g.players.d.score, -200);
  g.afterReveal();
  assert.equal(g.round.type, 'sprint');
});

test('Question piégée cannot be sent during the Duel des champions', () => {
  const { g } = game();
  g.start();
  g.round = { type: 'champions', n: 0 };
  g.phase = 'faceoff';
  g.useCard('a', 'piege', 'b', 'Sport');
  eq(g.traps, []);
  eq(g.players.a.cards, ['gel', 'piege']);
});

/** Duel des champions entre a et b ; c et d sont éliminés. */
function champions() {
  const env = game();
  const { g, clock } = env;
  g.start();
  Object.assign(g.players.a, { score: 500 });
  Object.assign(g.players.b, { score: 400 });
  g.roundIdx = 1;
  g.round = { type: 'champions', n: 0 };
  g.phase = 'intro';
  g.beginRound();
  g.advance(); // première question
  clock.t += 10000; // lecture terminée
  const buzz = (pid) => { g.buzz(pid); g.decideBuzz(g.q); };
  return { ...env, buzz };
}

test('Appel à un ami: an eliminated player answers in the finalist’s place', () => {
  const { g, buzz } = champions();
  eq(g.round.finalists, ['a', 'b']);
  buzz('a');
  eq(g.viewFor('a').friends.map((f) => f.id), ['c', 'd']);
  g.callFriend('a', 'b'); // pas l'autre finaliste
  assert.equal(g.q.buzz.proxy, undefined);
  g.callFriend('a', 'c');
  assert.equal(g.q.buzz.proxy, 'c');
  assert.equal(g.viewFor('c').screen, 'text');
  assert.equal(g.viewFor('a').screen, 'wait');
  g.answer('a', g.q.data.reponse); // le finaliste ne peut plus répondre lui-même
  assert.equal(g.round.hits.a, 0);
  g.answer('c', g.q.data.reponse);
  assert.equal(g.round.hits.a, 1, 'la bonne réponse de l’ami compte pour le finaliste');
  assert.equal(g.round.hits.c, undefined);
});

test('Appel à un ami: once per game for each finalist', () => {
  const { g, buzz, clock } = champions();
  buzz('a');
  g.callFriend('a', 'c');
  g.answer('c', 'faux');
  assert.equal(g.round.hits.a, 0);
  buzz('b');
  assert.ok(g.viewFor('b').friends, 'l’adversaire garde son appel');
  g.answer('b', 'faux');
  g.reveal(); g.afterReveal();
  clock.t += 10000;
  buzz('a');
  assert.equal(g.viewFor('a').friends, undefined);
  g.callFriend('a', 'd');
  assert.equal(g.q.buzz.proxy, undefined);
});
