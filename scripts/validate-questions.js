#!/usr/bin/env node
/* =========================================================================
 * PIXEL QUIZ ARENA - Vérification de la banque de questions
 *
 *   node scripts/validate-questions.js          (ou : npm run validate)
 *
 * Vérifie le format de chaque question, détecte les doublons (même question
 * ou question très proche avec la même réponse) et affiche des statistiques
 * par catégorie, par type et par difficulté. Code de sortie 1 en cas d'erreur.
 * Outil de développement uniquement : le jeu lui-même n'a pas besoin de Node.
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'questions');
const TYPES = ['qcm', 'fourchette', 'indices', 'vf', 'libre'];
const TARGET_TYPES = { qcm: 45, fourchette: 20, indices: 15, vf: 10, libre: 10 };
const errors = [];
const warnings = [];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set('le la les l un une des du de d a au aux en et ou est sont quel quelle quels quelles qui que quoi dont ce cette ces se sa son ses sur dans par pour pas plus il elle on y t qu s n combien comment'.split(' '));
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const all = [];
const ids = new Map();
for (const cat of index.categories) {
  const file = path.join(DIR, cat.file);
  if (!fs.existsSync(file)) { errors.push(`Fichier manquant : ${cat.file}`); continue; }
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { errors.push(`${cat.file} : JSON invalide (${e.message})`); continue; }
  if (!Array.isArray(list)) { errors.push(`${cat.file} : doit contenir un tableau`); continue; }
  list.forEach((q, i) => {
    const where = `${cat.file}#${i} (${q && q.id})`;
    const E = (m) => errors.push(`${where} : ${m}`);
    const W = (m) => warnings.push(`${where} : ${m}`);
    if (!q || typeof q !== 'object') return E('pas un objet');
    if (!q.id || typeof q.id !== 'string') E('id manquant');
    else if (ids.has(q.id)) E(`id en double (déjà dans ${ids.get(q.id)})`);
    else ids.set(q.id, cat.file);
    if (q.categorie !== cat.name) E(`categorie "${q.categorie}" ≠ "${cat.name}"`);
    if (!TYPES.includes(q.type)) E(`type inconnu "${q.type}"`);
    if (!Number.isInteger(q.difficulte) || q.difficulte < 1 || q.difficulte > 10) E('difficulte doit être un entier de 1 à 10');
    if (!q.question || q.question.length < 8) E('question trop courte');
    if (!q.anecdote || q.anecdote.length < 15) E('anecdote manquante ou trop courte');
    if (q.anecdote && q.anecdote.length > 260) W(`anecdote longue (${q.anecdote.length} car.)`);
    if (q.question && q.question.length > 200) W(`question longue (${q.question.length} car.)`);
    if (!q.sous_theme) W('sous_theme manquant');
    switch (q.type) {
      case 'qcm':
        if (!Array.isArray(q.choix) || q.choix.length !== 4) E('un QCM doit avoir 4 choix');
        else {
          if (new Set(q.choix.map(norm)).size !== 4) E('choix en double');
          if (!q.choix.includes(q.reponse)) E('la réponse doit être exactement l’un des choix');
          if (q.choix.some((c) => String(c).length > 48)) W('choix très long (lisibilité sur téléphone)');
        }
        break;
      case 'vf':
        if (q.reponse !== 'Vrai' && q.reponse !== 'Faux') E('reponse d’un vrai/faux : "Vrai" ou "Faux"');
        break;
      case 'fourchette':
        if (typeof q.reponse !== 'number' || !isFinite(q.reponse)) E('reponse numérique attendue');
        if (!Array.isArray(q.bornes) || q.bornes.length !== 2 || !(q.bornes[0] < q.bornes[1])) E('bornes [min, max] attendues (curseurs du téléphone)');
        else if (!(q.reponse > q.bornes[0] && q.reponse < q.bornes[1])) E('la réponse doit être strictement entre les bornes');
        else {
          // La réponse ne doit pas être trop facile à deviner à partir des bornes.
          const rel = (q.reponse - q.bornes[0]) / (q.bornes[1] - q.bornes[0]);
          if (Math.abs(rel - 0.5) < 0.01) W('réponse pile au milieu des bornes');
        }
        if (q.tolerance != null && (typeof q.tolerance !== 'number' || q.tolerance < 0)) E('tolerance doit être un nombre ≥ 0');
        if (typeof q.unite !== 'string') E('unite manquante (chaîne, éventuellement vide)');
        break;
      case 'indices':
        if (!Array.isArray(q.indices) || q.indices.length < 3 || q.indices.length > 5) E('3 à 5 indices attendus');
        if (!Array.isArray(q.reponses_acceptees)) W('reponses_acceptees conseillé pour les indices');
        if (q.indices && q.reponse && q.indices.slice(0, -1).some((c) => norm(c).includes(norm(q.reponse)) && norm(q.reponse).length > 3)) E('un indice (hors dernier) contient la réponse');
        break;
      case 'libre':
        if (!Array.isArray(q.reponses_acceptees)) E('reponses_acceptees attendu pour une réponse libre');
        break;
    }
    if (cat.name === 'Actualité') {
      if (!q.annee_reference) W('annee_reference conseillée pour l’actualité');
      if (!/20[2][0-6]/.test(q.question)) W('l’énoncé d’actualité devrait mentionner l’année');
    }
    all.push(q);
  });
}

// ---- Doublons ----
// Pour les indices, l'énoncé ("Qui suis-je ?") ne suffit pas : on compare aussi les indices.
const textOf = (q) => q.question + (q.type === 'indices' && q.indices ? ' ' + q.indices.join(' ') : '');
const prepared = all.map((q) => ({ q, w: words(textOf(q)), n: norm(textOf(q)), a: norm(q.reponse) }));
for (let i = 0; i < prepared.length; i++) {
  for (let j = i + 1; j < prepared.length; j++) {
    const A = prepared[i], B = prepared[j];
    if (A.n === B.n) { errors.push(`Doublon exact : ${A.q.id} / ${B.q.id}`); continue; }
    const sim = jaccard(A.w, B.w);
    const sameAnswer = A.a && A.a === B.a && typeof A.q.reponse !== 'number' && A.a !== 'vrai' && A.a !== 'faux';
    if (sim >= 0.75) errors.push(`Questions quasi identiques (${Math.round(sim * 100)} %) : ${A.q.id} / ${B.q.id}`);
    else if (sameAnswer && sim >= 0.4) errors.push(`Même réponse « ${A.q.reponse} » pour des questions proches : ${A.q.id} / ${B.q.id}`);
    else if (sameAnswer && A.q.type === B.q.type && A.q.categorie === B.q.categorie) warnings.push(`Même réponse « ${A.q.reponse} » (${A.q.type}) : ${A.q.id} / ${B.q.id}`);
  }
}

// ---- Statistiques ----
const pad = (s, n) => String(s).padEnd(n);
const byCat = {};
const byType = {};
const band = { 'faciles (1-3)': 0, 'moyennes (4-7)': 0, 'dures (8-10)': 0 };
for (const q of all) {
  const c = (byCat[q.categorie] = byCat[q.categorie] || { total: 0, types: {}, d: [0, 0, 0] });
  c.total++;
  c.types[q.type] = (c.types[q.type] || 0) + 1;
  c.d[q.difficulte <= 3 ? 0 : q.difficulte <= 7 ? 1 : 2]++;
  byType[q.type] = (byType[q.type] || 0) + 1;
  band[q.difficulte <= 3 ? 'faciles (1-3)' : q.difficulte <= 7 ? 'moyennes (4-7)' : 'dures (8-10)']++;
}
const N = all.length || 1;
console.log('\n=== PIXEL QUIZ ARENA · banque de questions ===\n');
console.log(pad('Catégorie', 28) + pad('Total', 7) + pad('Cible', 7) + pad('QCM', 5) + pad('Four', 5) + pad('Ind', 5) + pad('VF', 5) + pad('Lib', 5) + 'Faciles/Moy/Dures');
for (const cat of index.categories) {
  const c = byCat[cat.name] || { total: 0, types: {}, d: [0, 0, 0] };
  console.log(pad(cat.icon + ' ' + cat.name, 28) + pad(c.total, 7) + pad(cat.cible || '-', 7) + TYPES.map((t) => pad(c.types[t] || 0, 5)).join('') + c.d.join(' / '));
  if (c.total && c.d.some((x) => x === 0)) warnings.push(`${cat.name} : tous les niveaux de difficulté ne sont pas couverts`);
}
console.log('\nPar type :');
for (const t of TYPES) console.log('  ' + pad(t, 12) + pad(byType[t] || 0, 6) + Math.round(((byType[t] || 0) / N) * 100) + ' %   (cible ~' + TARGET_TYPES[t] + ' %)');
console.log('\nPar difficulté :');
for (const k in band) console.log('  ' + pad(k, 16) + pad(band[k], 6) + Math.round((band[k] / N) * 100) + ' %');
console.log(`\nTOTAL : ${all.length} questions`);

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} avertissement(s)` + (process.argv.includes('-v') ? ' :' : ' (détails avec -v)'));
  if (process.argv.includes('-v')) warnings.forEach((w) => console.log('  - ' + w));
}
if (errors.length) {
  console.log(`\n❌ ${errors.length} erreur(s) :`);
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
}
console.log('\n✅ Aucune erreur.\n');
