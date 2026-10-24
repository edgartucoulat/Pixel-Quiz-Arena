'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function game() {
  const s = { window: {}, performance: { now: () => 0 }, Math, console };
  for (const file of ['voice', 'chat', 'engine']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), s);
  const g = Object.create(s.window.PQA.Game.prototype);
  const p = { id: 'a', name: 'a', score: 0, streak: 0, bestStreak: 0, cards: [], stats: { correct: 0, wrong: 0, points: 0, hardCorrect: 0 } };
  Object.assign(g, {
    settings: { mode: 'online' }, players: { a: p }, round: { player: 'a', run: { streak: 0, best: 0, correct: 0, done: false, last: null } },
    fx() {}, say() {}, changed() {}, after() {}, quatreQuestion() {}, quatreEnd() {}, timerLeft: () => 30000,
    hooks: { send() {} },
  });
  return { g, p };
}
test('four in a row: 4 × 50 pts plus a flat 200 pts jackpot', () => {
  const { g, p } = game();
  for (let i = 0; i < 4; i++) {
    g.q = { answers: {}, data: { difficulte: 4 }, choices: ['x'], correctIdx: 0 };
    g.quatreAnswer('a', 0, true);
  }
  assert.equal(g.round.run.won, true);
  assert.equal(g.round.run.bonus, 200);
  assert.equal(p.score, 4 * 50 + 200);
});

/** Une vraie partie (sans écran) pour tester le choix des thèmes. */
function realGame(nCats) {
  const clock = { t: 1000 };
  const store = {};
  const s = {
    window: {}, performance: { now: () => clock.t }, Math, console, setInterval: () => 0,
    document: { addEventListener() {} }, navigator: {},
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) },
  };
  for (const file of ['common', 'voice', 'announcer', 'chat', 'engine']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), s);
  const cats = Array.from({ length: nCats }, (_, i) => ({ name: 'T' + i, icon: '?' }));
  const bank = [];
  cats.forEach((c) => { for (let i = 0; i < 10; i++) bank.push({ id: c.name + i, categorie: c.name, type: 'vf', difficulte: 4, question: c.name + i, reponse: 'Vrai' }); });
  const g = new s.window.PQA.Game(bank, cats, { changed() {}, fx() {}, say() {}, send() {} });
  Object.assign(g.settings, { rounds: ['quatre'], pixou: 'off' });
  for (const id of ['a', 'b']) {
    g.players[id] = { id, name: id, score: 0, streak: 0, bestStreak: 0, cards: [], frozenUntil: 0, connected: true, team: 0, rtt: 0, joinedAt: 0,
      stats: { correct: 0, wrong: 0, answered: 0, buzzWins: 0, wrongBuzz: 0, fastest: null, fourchette: 0, cardsUsed: 0, hardCorrect: 0, worstRank: 1, points: 0 } };
    g.order.push(id);
  }
  return { g, clock };
}

test('thème mystère: a hidden theme, never one of the themes shown', () => {
  for (let k = 0; k < 20; k++) {
    const { g } = realGame(8);
    g.start(); g.beginRound();
    const shown = g.round.themes.map((t) => t.name);
    const hidden = g.round.spare[0];
    assert.ok(hidden && !shown.includes(hidden));
    g.quatreTheme(g.round.player, 'mystere');
    assert.equal(g.round.cat, hidden);
    assert.ok(!shown.includes(g.round.cat));
  }
});

test('rules screen: 20 s the first time on this device, 5 s once already seen', () => {
  const { g } = realGame(6);
  g.start();
  assert.equal(g.timer.total, 20000);
  g.phase = 'lobby';
  g.start();
  assert.equal(g.timer.total, 5000);
});

test('4 à la suite : tout le monde joue, même à 6 joueurs', () => {
  const { g } = realGame(12);
  for (const id of ['c', 'd', 'e', 'f']) { g.players[id] = { ...g.players.a, id, name: id, stats: { ...g.players.a.stats } }; g.order.push(id); }
  g.start(); g.beginRound();
  assert.equal(g.round.total, 6);
  assert.equal(g.round.queue.length + 1, 6);
});

test('4 à la suite : la réponse choisie est gardée pour être affichée sur la TV', () => {
  const { g } = realGame(8);
  g.start(); g.beginRound();
  g.quatreTheme(g.round.player, 0);
  const q = g.q, wrong = (q.correctIdx + 1) % q.choices.length;
  g.answer(g.round.player, wrong);
  const last = g.round.run.last;
  assert.equal(last.picked, wrong);
  assert.equal(last.pickedText, q.choices[wrong]);
  assert.equal(last.qid, q.id);
  assert.equal(last.ok, false);
});
