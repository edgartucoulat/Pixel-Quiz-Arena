#!/usr/bin/env node
/* =========================================================================
 * PIXEL QUIZ ARENA - Liste des phrases à enregistrer pour la voix
 *
 *   node scripts/voice-lines.js > lines.json
 *
 * Sort [{ id, text, kind }] : les répliques fixes du présentateur, celles
 * du chat, les questions, les indices et les anecdotes. `id` est l'empreinte du texte
 * affiché (même calcul que js/voice.js), `text` est le texte à prononcer.
 * Utilisé par scripts/gen_voice.py.
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, fetch: () => Promise.reject(new Error('hors navigateur')), console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ['js/voice.js', 'js/announcer.js', 'js/chat.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
const PQA = sandbox.window.PQA;
const V = PQA.voice;

const out = new Map();
const add = (text, kind) => {
  if (!text || !String(text).trim()) return;
  const id = V.key(text);
  if (!out.has(id)) out.set(id, { id, text: V.prepare(text, kind), kind });
};

// Répliques : celles sans variable, et les morceaux fixes autour de {text}.
for (const list of Object.values(PQA.LINES)) {
  for (const t of list) {
    const vars = t.match(/\{\w+\}/g) || [];
    if (!vars.length) add(t, 'line');
    else if (vars.every((v) => v === '{text}')) t.split('{text}').forEach((part) => add(part, 'line'));
  }
}
// Répliques du chat, dans leur version parlée (sans le prénom quand Pixou interpelle) :
// la phrase entière, et chaque phrase sans variable pour les autres.
for (const list of Object.values(PQA.CHAT_LINES)) {
  for (const line of list) {
    const t = PQA.chatSpoken(line);
    if (!/\{\w+\}/.test(t)) add(t, 'line');
    else V.chunks(t).forEach((part) => { if (!/\{\w+\}/.test(part)) add(part, 'line'); });
  }
}
// Phrases fixes dites par l'interface.
['La voix du présentateur est activée !'].forEach((t) => add(t, 'line'));

// Questions, indices, anecdotes.
const dir = path.join(root, 'data/questions');
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
for (const c of idx.categories) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, c.file), 'utf8'));
  for (const q of list) {
    add(q.question, 'question');
    (q.indices || []).forEach((t) => add(t, 'question'));
    add(q.anecdote, 'question');
  }
}

process.stdout.write(JSON.stringify([...out.values()], null, 1) + '\n');
