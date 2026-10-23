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
  return { PQA: sandbox.window.PQA, audios, timers, ctx };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('blocked music retries on a gesture without a phase change', async () => {
  const f = fixture('music.js'), m = f.PQA.music;
  m.attach(f.ctx); m.play('theme');
  m.resume(); // respect the pending start/jingle delay
  assert.equal(f.audios[0].calls, 0);
  f.timers.get(m.cur.timer)(); await flush();
  assert.equal(f.audios[0].paused, true);
  f.audios[0].blocked = false; m.resume(); await flush();
  assert.equal(f.audios[0].paused, false);
  m.resume();
  assert.equal(f.audios[0].calls, 2);
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
