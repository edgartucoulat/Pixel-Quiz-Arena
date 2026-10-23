'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(file) {
  const timers = new Map();
  let serial = 0;
  const audios = [];
  class Audio {
    constructor(src) { this.src = src; this.paused = true; this.calls = 0; this.blocked = true; audios.push(this); }
    play() {
      this.calls++;
      if (this.blocked) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      this.paused = false;
      if (this.onplaying) this.onplaying();
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  const sandbox = {
    window: {}, Audio, console: { warn() {} },
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ cues: [] }) }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), sandbox);
  const gain = () => ({ gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} });
  const ctx = { currentTime: 0, destination: {}, createGain: gain, createMediaElementSource: () => ({ connect() {}, disconnect() {} }) };
  return { PQA: sandbox.window.PQA, audios, timers, ctx, sandbox };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('blocked music retries on a gesture without a phase change', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); m.play('theme');
  m.resume(); // primes the player inside the gesture, the delayed start stays pending
  assert.equal(f.audios[0].calls, 1);
  assert.notEqual(m.cur.timer, null);
  f.timers.get(m.cur.timer)(); await flush();
  assert.equal(f.audios[0].paused, true);
  f.audios[0].blocked = false; m.resume(); await flush();
  assert.equal(f.audios[0].paused, false);
  m.resume();
  assert.equal(f.audios[0].calls, 3);
});

test('failed jingle restores the wanted background', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); m.play('theme');
  m.load = () => Promise.resolve(null);
  m.sting('opening'); await flush();
  assert.equal(m.cur.name, 'theme');
  assert.equal(m.hold, 0);
});

test('blocked recorded voice retries and releases music ducking while waiting', async () => {
  const f = fixture('voice.js'), v = f.PQA.voice;
  v.bank = new Set([v.key('Bonjour !')]);
  v.speak('Bonjour !'); await flush();
  assert.equal(v.playing.blocked, true);
  assert.equal(v.talking, false);
  f.audios[0].blocked = false; v.resume(); await flush();
  assert.equal(v.talking, true);
  assert.equal(f.audios[0].calls, 2);
  f.audios[0].onended();
  assert.equal(v.playing, null);
  assert.equal(v.talking, false);
});

test('a stopped announcement is never replayed on the next gesture', async () => {
  const f = fixture('voice.js'), v = f.PQA.voice;
  v.bank = new Set([v.key('Bonjour !')]);
  v.speak('Bonjour !'); await flush();
  v.stop(); f.audios[0].blocked = false; v.resume(); await flush();
  assert.equal(f.audios[0].calls, 1);
  assert.equal(v.playing, null);
});


test('initial gesture primes one streaming player reused for the question countdown', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx);
  const player = f.audios[0]; player.blocked = false;
  m.resume(); await flush();
  assert.equal(m.primed, true);
  assert.equal(player.paused, true);
  m.play('theme'); f.timers.get(m.cur.timer)(); await flush();
  m.play('suspense'); f.timers.get(m.cur.timer)(); await flush();
  assert.equal(f.audios.length, 1);
  assert.equal(m.cur.audio, player);
  assert.equal(player.src, 'audio/music/suspense.webm');
  assert.equal(player.paused, false);
});

test('old fade cleanup cannot pause countdown music; pause still silences it', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); f.audios[0].blocked = false;
  m.play('theme'); f.timers.get(m.cur.timer)(); await flush();
  m.play('suspense');
  const cleanup = [...f.timers.entries()].filter(([id]) => id !== m.cur.timer).at(-1)[1];
  f.timers.get(m.cur.timer)(); await flush(); cleanup();
  assert.equal(m.cur.audio.paused, false);
  m.play(null);
  [...f.timers.values()].at(-1)();
  assert.equal(f.audios[0].paused, true);
});

test('leaving suspense resets the accelerated playback rate', () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); m.play('suspense'); m.tempo = 1.85;
  assert.ok(m.player.playbackRate > 1);
  m.play('leaderboard'); assert.equal(m.player.playbackRate, 1);
});

test('a gesture during the start delay unlocks the shared player for the delayed start', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); f.audios[0].blocked = false;
  m.play('theme'); // attach() from the first gesture schedules the background
  m.resume(); await flush();
  assert.equal(m.primed, true);
  f.timers.get(m.cur.timer)(); await flush();
  assert.equal(f.audios[0].paused, false);
});

test('recorded voice falls back to an audio element when Web Audio cannot decode it', async () => {
  const f = fixture('voice.js'), v = f.PQA.voice;
  f.sandbox.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  f.PQA.sfx = { ctx: { decodeAudioData: (b, ok, ko) => ko(new Error('EncodingError')) } };
  v.bank = new Set([v.key('Bonjour !'), v.key('Au revoir !')]);
  v.speak('Bonjour !');
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(v.decodeBroken, true);
  assert.equal(f.audios.length, 1);
  assert.equal(f.audios[0].src, 'audio/voice/' + v.key('Bonjour !') + '.webm');
  f.audios[0].blocked = false; v.resume(); await flush();
  assert.equal(v.talking, true);
  v.speak('Au revoir !'); await flush();
  assert.equal(f.audios.length, 2); // no second Web Audio attempt
});
