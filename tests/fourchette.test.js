'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function score(values, data = {}) {
  const s = { window: {}, performance: { now: () => 0 }, Math, console };
  for (const file of ['voice', 'chat', 'engine']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), s);
  const g = Object.create(s.window.PQA.Game.prototype), players = {}, answers = {};
  for (const [id, v] of Object.entries(values)) {
    players[id] = { id, name: id, score: 0, streak: 0, bestStreak: 0, cards: [], stats: { correct: 0, wrong: 0, fourchette: 0, points: 0, hardCorrect: 0 } };
    if (v != null) answers[id] = { value: v };
  }
  Object.assign(g, { players, fx() {}, say() {} });
  const q = { data: { reponse: 100, tolerance: 0, ...data }, answerers: Object.keys(values), answers, results: {} };
  g.scoreFourchette(q);
  return q.results;
}
const pts = (r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.pts]));
test('points go by rank: closest 200, then 100, 50, 25, then nothing', () => {
  assert.deepEqual(pts(score({ a: 90, b: 120, c: 101, d: 70, e: 300, f: 0 })), { c: 200, a: 100, b: 50, d: 25, e: 0, f: 0 });
});
test('ties share the rank and the points', () => {
  const r = score({ a: 95, b: 105, c: 110 });
  assert.deepEqual(pts(r), { a: 200, b: 200, c: 50 });
  assert.equal(r.c.rank, 3);
});
test('an exact answer adds the 500 bonus; answers within tolerance count as exact', () => {
  const r = score({ a: 100, b: 101, c: 90 }, { tolerance: 1 });
  assert.deepEqual(pts(r), { a: 700, b: 700, c: 50 });
  assert.equal(r.a.exact, true);
});
test('no answer scores nothing', () => {
  assert.deepEqual(pts(score({ a: 50, b: null })), { a: 200, b: 0 });
});
