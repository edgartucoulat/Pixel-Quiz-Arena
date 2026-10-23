'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function setup(bank) {
  const store = {};
  const localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => (store[k] = v) };
  const PQA = { normalize: (s) => String(s).toLowerCase() };
  const sandbox = { window: { PQA }, performance: { now: () => 0 }, localStorage, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'engine.js'), 'utf8'), sandbox);
  const game = Object.create(PQA.Game.prototype);
  Object.assign(game, { bank, used: new Set(), seen: new Set(), playerSeen: {}, recentThemes: [], players: {}, order: ['a'] });
  game.players.a = { id: 'a' };
  return game;
}
const q = (id, sous_theme) => ({ id, type: 'qcm', categorie: 'Sport', sous_theme, difficulte: 5, reponse: id });
test('questions already seen on a player phone are avoided', () => {
  const game = setup([q('q1', 'A'), q('q2', 'B'), q('q3', 'C')]);
  game.notePlayerSeen('a', ['q1', 'q2']);
  assert.equal(game.pickQuestion({ types: ['qcm'] }).id, 'q3');
});
test('recent sub-themes are skipped when another one is available', () => {
  const game = setup([q('q1', 'Tennis'), q('q2', 'Tennis'), q('q3', 'Foot')]);
  game.recentThemes = ['Tennis'];
  assert.equal(game.pickQuestion({ types: ['qcm'] }).id, 'q3');
});
test('when everything was seen, the oldest seen question comes back first', () => {
  const game = setup([q('q1', 'A'), q('q2', 'B'), q('q3', 'C')]);
  game.seen = new Set(['q2', 'q3', 'q1']);
  assert.equal(game.pickQuestion({ types: ['qcm'] }).id, 'q2');
});
