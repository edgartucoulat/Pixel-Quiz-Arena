/* =========================================================================
 * PIXEL QUIZ ARENA - Télécommande du présentateur IRL
 * Affiche la question, la bonne réponse et l'anecdote, et permet de piloter
 * l'émission : valider / refuser, révéler, question suivante, points...
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = window.PQA;
  const { $, esc, fmt } = PQA;
  const qs = new URLSearchParams(location.search);
  let room = (qs.get('room') || localStorage.getItem('pqa_presenter_room') || '').toUpperCase();
  let view = null, deadline = 0, total = 0;

  let netStatus = 'idle';
  PQA.onNetDiag = () => net && net.h.onStatus(netStatus);
  const net = new PQA.ClientNet({
    getHello: () => ({ t: 'hello', role: 'presenter' }),
    onStatus(s) {
      netStatus = s;
      const txt = { connecting: '⏳ Connexion au plateau...', reconnecting: '🔄 Reconnexion...', noroom: '❓ Salle introuvable (nouvelle tentative...)' }[s] || '';
      // Diagnostic sous le message, pour savoir quel canal passe ou bloque.
      $('#netbar').innerHTML = txt ? '<span>' + PQA.esc(txt) + '</span><small>' + PQA.esc(PQA.netDiagText()) + '</small>' : '';
      $('#netbar').classList.toggle('on', !!txt);
    },
    onMessage(m) {
      if (m.t === 'welcome') { PQA._wantAwake = true; PQA.keepAwake(); return; }
      if (m.t === 'view') {
        view = m.v;
        if (m.left != null) { deadline = performance.now() + m.left; total = view.timer ? view.timer.total : 0; } else deadline = 0;
        render();
      }
    },
  });

  function showJoin() {
    $('#screen').innerHTML = `<div class="join">
      <div class="logo small"><span>PIXEL</span><span>QUIZ</span><span>ARENA</span></div>
      <div class="wtitle">🎤 Télécommande du présentateur</div>
      <label>Code de la salle</label>
      <input id="in-room" class="code" maxlength="4" value="${esc(room)}" placeholder="ABCD" autocapitalize="characters">
      <button class="big-btn" id="btn-go">▶ PRENDRE LE MICRO</button>
      <div class="hint">Choisis le mode « Présentateur IRL » sur l’écran plateau pour piloter toute l’émission.</div></div>`;
    $('#btn-go').onclick = () => {
      room = $('#in-room').value.trim().toUpperCase();
      if (room.length !== 4) return;
      localStorage.setItem('pqa_presenter_room', room);
      $('#screen').innerHTML = '<div class="wait"><div class="spinner"></div></div>';
      net.connect(room);
    };
  }

  const cmd = (c, extra) => { net.send({ t: 'pcmd', cmd: c, ...extra }); PQA.vibrate(25); };
  const TYPE = { qcm: 'QCM', vf: 'Vrai / Faux', fourchette: 'Fourchette', indices: 'Indices', libre: 'Réponse libre' };

  function render() {
    const v = view;
    $('#phead').innerHTML = `<b>🎤 ${esc(v.roundName || (v.phase === 'lobby' ? 'Accueil' : ''))}</b><span>${esc(room)}</span>`;
    let html = '<div class="ptimer"><div id="ptimer-fill"></div></div>';
    if (v.mode !== 'irl') html += '<div class="pwarn">ℹ️ Le plateau est en mode « ' + (v.mode === 'duel' ? 'Duel' : 'Présentateur virtuel') + ' » : la partie avance toute seule, mais tu peux quand même piloter.</div>';
    if (v.phase === 'lobby') html += `<div class="wait"><div class="wtitle">En attente des joueurs</div><div class="wmsg">${v.players.length} joueur(s) connecté(s)</div>${v.canStart ? '<button class="big-btn green" data-c="start">▶ LANCER L’ÉMISSION</button>' : ''}</div>`;
    if (v.info) html += `<div class="pinfo">${esc(v.info)}</div>`;
    if (v.q) {
      const q = v.q;
      html += `<div class="pcard">
        <div class="pmeta">${esc(q.categorie)} · ${TYPE[q.type] || q.type} · difficulté ${q.difficulte}/10${v.expected ? ` · ${v.answered}/${v.expected} réponses` : ''}</div>
        <div class="pquestion">${esc(q.question)}</div>
        ${q.indices ? `<ol class="pclues">${q.indices.map((c, i) => `<li class="${i <= q.clue ? 'on' : ''}">${esc(c)}</li>`).join('')}</ol>` : ''}
        ${q.choices ? `<div class="pchs">${q.choices.map((c, i) => `<div class="${i === q.correctIdx ? 'ok' : ''}">${i === q.correctIdx ? '✔' : '·'} ${esc(c)}</div>`).join('')}</div>` : ''}
        <div class="panswer">✔ ${esc(q.answer)}</div>
        ${q.accepted && q.accepted.length ? `<div class="paccept">Accepté aussi : ${q.accepted.map(esc).join(', ')}</div>` : ''}
        <div class="panec"><b>À lire :</b> 💡 Le saviez-vous ? ${esc(q.anecdote || '')}</div>
      </div>`;
    }
    if (v.pending) {
      html += `<div class="ppending"><div>${v.pending.oral ? '🎤' : '✍️'} <b>${esc(v.pending.name)}</b> ${v.pending.text ? (v.pending.oral ? 'répond à voix haute' : 'répond : « ' + esc(v.pending.text) + ' »') : 'a buzzé !'}</div>
        <div class="pvalid"><button class="ok" data-c="validate">✔ VALIDER</button><button class="ko" data-c="refuse">✖ REFUSER</button></div></div>`;
    }
    const phaseBtns = [];
    if (v.phase === 'question') phaseBtns.push(['reveal', '👁 Révéler'], ['skip', '⏭ Passer']);
    if (v.q && v.q.indices && v.phase === 'question') phaseBtns.push(['clue', '➕ Indice suivant']);
    if (['intro', 'reveal', 'leaderboard', 'faceoff', 'champion', 'cell', 'qresult', 'ko', 'wheel'].includes(v.phase)) phaseBtns.push(['next', v.phase === 'reveal' ? '▶ Question suivante' : '▶ Suivant']);
    if (v.phase !== 'lobby') phaseBtns.push(['pause', v.paused ? '▶ Reprendre' : '⏸ Pause']);
    html += `<div class="pbtns">${phaseBtns.map(([c, l]) => `<button data-c="${c}" class="${c === 'next' ? 'main' : ''}">${l}</button>`).join('')}</div>`;
    html += `<div class="pplayers"><div class="pmeta">Points (bonus / malus)</div>${v.players.map((p) => `<div class="pp ${p.connected ? '' : 'off'}" style="--oc:${p.color}">
      <span class="ppn">${esc(p.name)}</span><span class="pps">${fmt(p.score)}</span>
      <button data-c="points" data-pid="${p.id}" data-d="-50">−50</button><button data-c="points" data-pid="${p.id}" data-d="50">+50</button><button data-c="points" data-pid="${p.id}" data-d="100">+100</button></div>`).join('')}</div>`;
    $('#screen').innerHTML = html;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    if (b.dataset.c === 'points') cmd('points', { pid: b.dataset.pid, delta: Number(b.dataset.d) });
    else cmd(b.dataset.c);
  });

  (function loop() {
    requestAnimationFrame(loop);
    const f = document.getElementById('ptimer-fill');
    if (!f) return;
    if (!deadline || !total) { f.parentElement.style.visibility = 'hidden'; return; }
    f.parentElement.style.visibility = 'visible';
    const left = Math.max(0, deadline - performance.now());
    f.style.width = (left / total) * 100 + '%';
  })();

  if (qs.get('room')) { $('#screen').innerHTML = '<div class="wait"><div class="spinner"></div></div>'; net.connect(room); }
  else showJoin();
})();
