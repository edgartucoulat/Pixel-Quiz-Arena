'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function setup() {
  const calls = [];
  const voice = { queue: [], playing: null, speak: (text, opts) => calls.push({ text, opts }), stop() { this.queue = []; this.playing = null; } };
  const PQA = { voice, sfx: { whoosh() {} } };
  const sandbox = { window: { PQA }, performance: { now: () => 10000 }, console };
  for (const file of ['engine', 'host-ui']) vm.runInNewContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox);
  const ui = Object.create(PQA.HostUI.prototype);
  ui.g = { settings: { mode: 'solo' }, players: {}, q: { data: { question: 'Question ?' } } };
  return { PQA, ui, voice, calls };
}
test('every 4-a-row question emits the reading event and preserves its timer', () => {
  const { PQA } = setup(), game = Object.create(PQA.Game.prototype), events = [];
  const timer = {};
  Object.assign(game, { round: { cat: 'Sport', player: 'p', run: { streak: 0 } }, timer,
    pickQuestion: () => ({ question: 'Question ?' }),
    makeQ(data) { this.q = { data }; this.timer = null; return this.q; },
    changed() {}, fx: name => events.push(name) });
  game.quatreQuestion(); game.quatreQuestion();
  assert.deepEqual(events, ['question', 'question']);
  assert.equal(game.timer, timer);
});
test('buzz and roast announcements queue behind current or pending questions', () => {
  const { ui, voice, calls } = setup();
  voice.playing = { seg: { kind: 'question' } };
  ui.say('Un buzz !'); assert.equal(calls.at(-1).opts.queue, true);
  voice.playing = null; voice.queue = [{ kind: 'question' }];
  ui.lastSay = 0; ui.say('Une pique !'); assert.equal(calls.at(-1).opts.queue, true);
});
test('new question takes priority over introductory chatter', async () => {
  const { ui, calls } = setup();
  ui.fx('question', {}); ui.say('Question suivante !');
  await Promise.resolve();
  assert.equal(calls.at(-1).text, 'Question ?');
  assert.equal(calls.at(-1).opts.kind, 'question');
  assert.equal(calls.at(-1).opts.queue, false);
});
test('deferred reading ignores a question that has been replaced', async () => {
  const { ui, calls } = setup();
  ui.fx('question', {}); ui.g.q = { data: { question: 'Autre question ?' } };
  await Promise.resolve(); assert.equal(calls.length, 0);
});
test('IRL mode keeps automatic reading disabled', async () => {
  const { ui, calls } = setup(); ui.g.settings.mode = 'irl';
  ui.fx('question', {}); await Promise.resolve(); assert.equal(calls.length, 0);
});
test('all questions and initial clue combinations have a recorded speech plan', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/voice.js'), 'utf8'), sandbox);
  const voice = sandbox.window.PQA.voice;
  voice.bank = new Set(JSON.parse(fs.readFileSync(path.join(root, 'audio/voice/manifest.json'))).ids);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data/questions/index.json')));
  for (const category of index.categories) for (const q of JSON.parse(fs.readFileSync(path.join(root, 'data/questions', category.file)))) {
    assert.ok(voice.plan(q.question, 'question'), q.id);
    if (q.indices) assert.ok(voice.plan(q.question + ' ' + q.indices[0], 'question'), q.id);
  }
});

function recordedFixture() {
  const sources = [], timers = new Map(); let serial = 0, fetches = 0;
  const ctx = {
    destination: {},
    decodeAudioData(bytes, ok) { ok({ duration: 3 }); },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  const sandbox = { window: { PQA: { sfx: { ctx } } }, console,
    Audio: class { constructor() { throw new Error('Unexpected HTML audio'); } },
    fetch: async () => { fetches++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; },
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/voice.js'), 'utf8'), sandbox);
  const voice = sandbox.window.PQA.voice;
  voice.bank = new Set(['Première question ?', 'Deuxième question ?'].map(t => voice.key(t)));
  return { voice, sources, timers, fetches: () => fetches };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('two consecutive Sprint recordings use the unlocked context without creating HTML audio', async () => {
  const f = recordedFixture();
  f.voice.speak('Première question ?', { kind: 'question' }); await settle();
  assert.equal(f.sources[0].started, true);
  f.sources[0].onended();
  f.voice.speak('Deuxième question ?', { kind: 'question' }); await settle();
  assert.equal(f.sources[1].started, true);
  assert.equal(f.fetches(), 2);
  assert.equal(f.timers.size, 0);
});
test('a cancelled network load cannot start an obsolete question', async () => {
  const f = recordedFixture();
  f.voice.speak('Première question ?', { kind: 'question' });
  f.voice.stop(); await settle(); assert.equal(f.sources.length, 0);
});
test('changing question stops its buffer source and replay uses the bounded cache', async () => {
  const f = recordedFixture();
  f.voice.speak('Première question ?', { kind: 'question' }); await settle();
  f.voice.speak('Première question ?', { kind: 'question' }); await settle();
  assert.equal(f.sources[0].stopped, true);
  assert.equal(f.sources[1].started, true);
  assert.equal(f.fetches(), 1);
});
