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
