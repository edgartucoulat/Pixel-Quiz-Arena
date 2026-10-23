'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture() {
  let time = 100000, random = 0;
  const math = Object.create(Math); math.random = () => random;
  const s = { window: {}, performance: { now: () => time }, Math: math, console };
  for (const file of ['voice', 'chat', 'engine']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), s);
  const P = s.window.PQA, g = Object.create(P.Game.prototype), said = [], chat = [];
  Object.assign(g, { settings: { mode: 'solo', pixou: 'on' }, players: { a: { id: 'a', name: 'Alice', connected: true }, b: { id: 'b', name: 'Bot', bot: true } }, hooks: { say: (...x) => said.push(x) }, chat: { add: x => chat.push(x) }, q: {}, paused: false });
  g.name = id => g.players[id].name;
  return { P, g, said, chat, clock: t => { time = t; }, random: r => { random = r; } };
}
test('gameplay roast is targeted, spoken, visible without opening chat, and emitted once per question', () => {
  const f = fixture();
  assert.equal(f.g.maybeRoast([{ pid: 'a', kind: 'wrong' }]), true);
  assert.match(f.g.lastSay.text, /Alice/);
  assert.equal(f.said[0][2].includes('Alice'), false);
  assert.equal(f.chat.length, 1);
  f.clock(200000);
  assert.equal(f.g.maybeRoast([{ pid: 'b', kind: 'wrong' }]), false);
});
test('cooldowns, probability and off/IRL settings prevent excessive roasts', () => {
  const f = fixture(); const attempt = pid => { f.g.q = {}; return f.g.maybeRoast([{ pid, kind: 'timeout' }]); };
  assert.equal(attempt('a'), true);
  f.clock(120000); assert.equal(attempt('b'), false);
  f.clock(130000); assert.equal(attempt('a'), false);
  assert.equal(attempt('b'), true);
  f.clock(200000); f.random(0.9); assert.equal(attempt('a'), false);
  f.random(0); f.g.settings.pixou = 'off'; assert.equal(attempt('a'), false);
  f.g.settings.pixou = 'on'; f.g.settings.mode = 'irl'; assert.equal(attempt('a'), false);
});
test('reveal selects actual wrong and missing answers, not successful players', () => {
  const f = fixture(), q = { kind: 'all', data: {}, answerers: ['a','b'], results: { a: { correct: true }, b: { correct: false, none: true } } };
  let candidates;
  f.g.maybeRoast = xs => { candidates = xs; return true; };
  f.g.commentReveal(q, ['a']);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].pid, 'b'); assert.equal(candidates[0].kind, 'timeout');
});
test('a player who did not buzz is only eligible when nobody won', () => {
  const f = fixture(), q = { kind: 'buzz', data: {}, answerers: ['a','b'], results: { a: { correct: true } } };
  let candidates;
  f.g.maybeRoast = xs => { candidates = xs; return true; };
  f.g.commentReveal(q, ['a']); assert.equal(candidates.length, 0);
  q.results = {}; f.g.commentReveal(q, []); assert.equal(candidates.length, 2);
});
test('all gameplay roast speech is already recorded', () => {
  const f = fixture();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../audio/voice/manifest.json'), 'utf8'));
  const bank = new Set(manifest.ids);
  for (const lines of Object.values(f.P.GAME_ROASTS)) for (const line of lines) {
    const spoken = f.P.chatSpoken(line);
    assert.equal(bank.has(f.P.voice.key(spoken)), true, spoken);
  }
});
