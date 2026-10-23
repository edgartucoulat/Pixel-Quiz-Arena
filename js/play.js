/* =========================================================================
 * PIXEL QUIZ ARENA - Manette joueur (téléphone)
 * Le téléphone n'affiche que la "vue" envoyée par le plateau et lui envoie
 * des intentions (buzz, réponse...). Le plateau valide tout.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = window.PQA;
  const { $, $$, esc, patch, fmt } = PQA;
  const STORE = 'pqa_player';
  const LETTERS = ['A', 'B', 'C', 'D'];

  const qs = new URLSearchParams(location.search);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) {}

  const state = {
    room: (qs.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4),
    name: saved.name || '',
    avatar: saved.avatar || PQA.randomAvatar(),
    token: null,
    view: null,
    deadline: 0,
    total: 0,
    joined: false,
    editing: false,
    renderKey: null,
    pressed: false,
  };
  // Reconnexion automatique si on revient dans la même salle
  if (saved.room && saved.token && (!state.room || saved.room === state.room)) {
    state.room = saved.room;
    state.token = saved.token;
  }
  // Questions déjà vues sur ce téléphone, envoyées au plateau pour qu'il ne les repose pas,
  // même si la partie est hébergée sur un autre écran.
  const SEEN_STORE = 'pqa_player_seen';
  const SEEN_MAX = 1500;
  let seenQ = [];
  try { seenQ = JSON.parse(localStorage.getItem(SEEN_STORE) || '[]'); } catch (e) {}
  if (!Array.isArray(seenQ)) seenQ = [];
  function noteSeen(id) {
    if (!id || seenQ[seenQ.length - 1] === id) return;
    seenQ = seenQ.filter((x) => x !== id).concat(id).slice(-SEEN_MAX);
    try { localStorage.setItem(SEEN_STORE, JSON.stringify(seenQ)); } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ room: state.room, token: state.token, name: state.name, avatar: state.avatar })); } catch (e) {}
  }

  /** Manette intégrée au plateau (mode Solo) : on parle directement à la page parente, sans réseau. */
  const LOCAL = qs.get('local') === '1' && window.parent !== window;
  class LocalNet {
    constructor(h) {
      this.h = h;
      window.addEventListener('message', (e) => { if (e.source === window.parent && e.data && e.data.pqa) h.onMessage(e.data.pqa); });
    }
    connect(code) { this.code = code; this.h.onStatus('connected'); this.send(this.h.getHello()); }
    send(m) { window.parent.postMessage({ pqaLocal: m }, '*'); }
    stop() { this.send({ t: 'bye' }); }
    checkHealth() {}
  }
  /** Mode « Jouer sur téléphones » : la manette de l'hôte prend tout l'écran et règle la partie. */
  const OWNER = LOCAL && qs.get('phones') === '1';
  if (LOCAL) document.body.classList.add(OWNER ? 'owner' : 'local-pad');
  // Appel synchrone depuis le geste : postMessage perdrait ce contexte.
  // Seule la manette intégrée, de même origine, réveille le son du plateau.
  if (LOCAL) {
    const unlockHostAudio = () => {
      try { window.parent.PQA.sfx.unlock(); } catch (e) { /* parent inaccessible */ }
    };
    document.addEventListener('click', unlockHostAudio, true);
    document.addEventListener('touchend', unlockHostAudio, { capture: true, passive: true });
    document.addEventListener('keydown', unlockHostAudio, true);
  }
  /** Manette intégrée : petite tant qu'il n'y a rien à faire, plus grande pour répondre ou choisir. */
  const PAD_SMALL = ['wait', 'lobby', 'locked', 'result', 'end', 'oral', 'kicked'];
  let padLast = null;
  function padSize(screen) {
    const size = PAD_SMALL.includes(screen) ? 'small' : screen === 'buzzer' ? 'buzz' : 'large';
    if (size !== padLast) { padLast = size; window.parent.postMessage({ pqaLocal: { t: '_pad', size } }, '*'); }
  }
  // Au clavier (manette intégrée du mode Solo, ou téléphone avec clavier) : Espace pour buzzer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const b = document.getElementById('buzzer');
    if (b && !b.disabled) { e.preventDefault(); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
  });

  let netStatus = 'idle';
  PQA.onNetDiag = () => net && net.h.onStatus(netStatus);
  const net = new (LOCAL ? LocalNet : PQA.ClientNet)({
    getHello: () => ({ t: 'hello', role: 'player', token: state.token, name: state.name, avatar: state.avatar, seen: seenQ, v: 1 }),
    onStatus(s) {
      netStatus = s;
      const txt = { connecting: '⏳ Connexion au plateau...', reconnecting: '🔄 Reconnexion...', noroom: '❓ Salle introuvable : vérifie le code (nouvelle tentative...)', connected: '' }[s] || '';
      // Diagnostic sous le message, pour savoir quel canal passe ou bloque.
      $('#netbar').innerHTML = txt ? '<span>' + PQA.esc(txt) + '</span><small>' + PQA.esc(PQA.netDiagText()) + '</small>'
        + (state.view ? '<button class="mini-btn" data-act="leave">↩ Changer de salle</button>' : '') : '';
      $('#netbar').classList.toggle('on', !!txt);
    },
    onMessage(m) {
      if (m.t === 'welcome') {
        state.token = m.token; state.joined = true; save();
        state.myId = m.id;
        document.body.classList.add('joined');
        PQA._wantAwake = true; PQA.keepAwake();
        return;
      }
      if (m.t === 'error') { net.stop(); state.joined = false; showJoin(m.text); return; }
      if (m.t === 'view') {
        state.view = m.v;
        noteSeen(m.v.seenId);
        if (m.left != null) { state.deadline = performance.now() + m.left; state.total = m.v.timer ? m.v.timer.total : 0; }
        else state.deadline = 0;
        render();
        return;
      }
      if (m.t === 'fx') return fx(m);
      if (m.t === 'toast') return toast(m.text);
      if (m.t === 'chatlog') { chat.list = []; (m.list || []).forEach((x) => chatAdd(x, true)); chatRender(); return; }
      if (m.t === 'chat') return chatAdd(m.m);
    },
  });

  /* ======================= Écran de connexion ===================== */
  function showConnecting(msg) {
    state.renderKey = 'connecting';
    $('#screen').innerHTML = `<div class="wait"><div class="spinner"></div><div class="wmsg">${msg}</div>
      <button class="mini-btn" data-act="leave">↩ Changer de salle</button></div>`;
  }
  /** Abandonne la salle en cours (ou enregistrée) pour en rejoindre une autre. */
  function leaveRoom() {
    net.stop();
    state.room = '';
    state.token = null;
    state.joined = false;
    state.view = null;
    state.editing = false;
    save();
    // Le code de l'ancienne salle ne doit pas revenir au prochain rechargement.
    try { const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u); } catch (e) {}
    $('#netbar').classList.remove('on');
    showJoin();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="leave"]')) { PQA.vibrate(20); leaveRoom(); }
  });

  function showJoin(error) {
    state.renderKey = 'join';
    if (LOCAL) padSize('join');
    $('#me').innerHTML = '';
    $('#cards').innerHTML = '';
    $('#screen').innerHTML = `
      <div class="join">
        <div class="logo small"><span>PIXEL</span><span>QUIZ</span><span>ARENA</span></div>
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
        <label>Code de la salle</label>
        <input id="in-room" class="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(state.room)}" placeholder="ABCD" ${state.editing || LOCAL ? 'disabled' : ''}>
        <label>Ton pseudo</label>
        <input id="in-name" maxlength="14" autocomplete="nickname" value="${esc(state.name)}" placeholder="Ex : Mamie Quiz">
        <label>Ton avatar</label>
        ${avatarEditor()}
        <button class="big-btn green" id="btn-join">${state.editing ? '✔ VALIDER' : '▶ ENTRER SUR LE PLATEAU'}</button>
      </div>`;
    const room = $('#in-room');
    room.addEventListener('input', () => { room.value = room.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('#btn-join').onclick = () => {
      const r = room.value.trim().toUpperCase();
      const n = $('#in-name').value.trim();
      if (r.length !== 4) return toast('Le code fait 4 lettres');
      if (!n) return toast('Choisis un pseudo !');
      state.name = n;
      if (state.editing) {
        state.editing = false;
        save();
        net.send({ t: 'profile', name: n, avatar: state.avatar });
        state.renderKey = null;
        render();
        return;
      }
      // Nouvelle salle = nouveau joueur. Le jeton est créé ici pour qu'une reconnexion
      // pendant la toute première connexion ne crée pas un doublon.
      if (r !== state.room || !state.token) state.token = PQA.randomToken();
      state.room = r;
      save();
      PQA.vibrate(30);
      showConnecting('Connexion au plateau...');
      net.connect(r);
    };
    bindAvatarEditor();
  }

  function avatarEditor() {
    const parts = [['s', 'Peau'], ['h', 'Coiffure'], ['hc', 'Cheveux'], ['e', 'Yeux'], ['a', 'Accessoire']];
    return `<div class="av-edit">
      <img class="pix av-prev" id="av-prev" src="${PQA.avatarURL(state.avatar, '#41a6f6', 'idle', 8)}" alt="">
      <div class="av-parts">${parts.map(([k, l]) => `<div class="av-row"><button data-part="${k}" data-d="-1">◀</button><span>${l}</span><button data-part="${k}" data-d="1">▶</button></div>`).join('')}
      <button class="av-rand" id="av-rand">🎲 Au hasard</button></div></div>`;
  }
  function bindAvatarEditor() {
    const upd = () => { $('#av-prev').src = PQA.avatarURL(state.avatar, '#41a6f6', 'happy', 8); };
    $$('.av-row button').forEach((b) => (b.onclick = () => {
      const k = b.dataset.part, n = PQA.AVATAR_PARTS[k];
      state.avatar = { ...state.avatar, [k]: ((state.avatar[k] || 0) + Number(b.dataset.d) + n) % n };
      upd();
    }));
    $('#av-rand').onclick = () => { state.avatar = PQA.randomAvatar(); upd(); PQA.vibrate(15); };
  }

  /* ======================= Rendu de la vue ======================== */
  function render() {
    const v = state.view;
    if (!v || state.editing) return;
    if (v.screen === 'kicked') { net.stop(); state.token = null; save(); showJoin('Tu as été retiré de la partie.'); return; }
    renderMe(v);
    renderCards(v);
    renderTV(v);
    renderOwnerBar(v);
    const out = v.screen === 'lobby' && v.owner ? ownerLobby(v) : screens[v.screen] ? screens[v.screen](v) : screens.wait(v);
    document.body.dataset.screen = v.screen;
    document.body.style.setProperty('--me', v.me.color);
    if (LOCAL) padSize(v.screen);
    if (out.key !== state.renderKey) {
      // Le panneau de l'hôte est long : on garde la position de défilement quand il se met à jour.
      const scroll = out.keepScroll && state.renderKey && state.renderKey.startsWith('owner') ? $('#screen').scrollTop : 0;
      state.renderKey = out.key;
      state.pressed = false;
      $('#screen').innerHTML = out.html;
      $('#screen').scrollTop = scroll;
      out.after && out.after();
    } else if (out.parts) {
      for (const id in out.parts) patch(document.getElementById(id), out.parts[id]);
    }
  }

  function renderMe(v) {
    const m = v.me;
    const team = m.teamName ? `<span class="team" style="background:${m.teamColor}">${esc(m.teamName)}</span>` : '';
    patch($('#me'), `<img class="pix av" src="${PQA.avatarURL(m.avatar, m.color, 'idle', 4)}" alt="">
      <div class="me-info"><b style="color:${m.color}">${esc(m.name)}</b>${team}<small>${m.rank}${m.rank === 1 ? 'er' : 'e'} / ${m.total}${m.streak >= 3 ? ` · 🔥+${m.bonus}` : ''}${m.shield ? ' · 🛡️' : ''}</small></div>
      <div class="me-score">${fmt(m.score)}<small>pts</small></div>`);
  }

  function renderCards(v) {
    const cards = v.me.cards || [];
    patch($('#cards'), cards.length && v.canCard ? cards.map((c, i) => `<button class="card-btn" data-card="${c}" data-i="${i}">${PQA.CARDS[c].icon}<span>${esc(PQA.CARDS[c].name)}</span></button>`).join('') : '');
  }

  const timerBar = () => '<div class="ptimer"><div id="ptimer-fill"></div></div>';
  const choiceBtns = (v, action, picked, extraCls = '') => {
    if (!v.choices) return '';
    const n = v.choices.list.length;
    return `<div class="pchoices n${n} ${v.choices.mirror ? 'mirror' : ''} ${extraCls}">${v.choices.list.map((c, k) => `
      <button class="pchoice c${c.i} ${picked === c.i ? 'picked' : ''} ${c.hidden ? 'hidden' : ''}" data-act="${action}" data-val="${c.i}" ${c.hidden ? 'disabled' : ''}>
        <span class="letter">${n === 2 ? (c.i === 0 ? '✔' : '✖') : LETTERS[c.i]}</span><span class="ctext">${esc(c.text)}</span></button>`).join('')}</div>`;
  };

  const screens = {
    lobby(v) {
      const m = v.me;
      return {
        key: 'lobby' + m.name + JSON.stringify(m.avatar) + m.team + m.color + (v.tv ? v.tv.rank.map((p) => p.name).join() : ''),
        html: `<div class="wait lobby">
          <img class="pix av-big" src="${PQA.avatarURL(m.avatar, m.color, 'happy', 8)}" alt="">
          <div class="wtitle">${v.tv ? 'Tu es dans la salle !' : 'Tu es sur le plateau !'}</div>
          ${m.teamName ? `<div class="team big" style="background:${m.teamColor}">Équipe des ${esc(m.teamName)}</div>` : ''}
          <div class="wmsg">${v.tv ? 'L’hôte lance la partie dès que tout le monde est là. En attendant, viens papoter dans le chat 💬' : 'Regarde l’écran, l’émission va commencer.'}</div>
          ${v.tv ? `<div class="tv-who">${v.tv.rank.map((p) => `<span style="--pc:${p.color}">${p.bot ? '🤖 ' : ''}${esc(p.name)}</span>`).join('')}</div>` : ''}
          <button class="small-btn" id="btn-edit">✏️ Modifier mon profil</button>
        </div>`,
        after() { $('#btn-edit').onclick = () => { state.editing = true; showJoin(); }; },
      };
    },
    wait(v) {
      if (v.tv) {
        const t = v.tv, board = v.phase === 'leaderboard';
        const msg = (v.msg || '').replace('Regarde l’écran !', '');
        return {
          key: 'wait' + v.title + msg + v.phase + tvKey(v) + (board ? JSON.stringify(t.rank) : ''),
          html: `${v.timer ? timerBar() : ''}<div class="wait tvwait"><div class="wtitle">${esc(v.title || '')}</div>${msg ? `<div class="wmsg">${esc(msg)}</div>` : ''}
            ${t.rules ? `<ul class="tv-rules">${t.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${tvQuestion(v)}${board ? tvRanking(v) : ''}</div>`,
        };
      }
      return { key: 'wait' + v.title + v.msg + v.phase, html: `<div class="wait"><div class="wtitle">${esc(v.title || 'Regarde l’écran !')}</div><div class="wmsg">${esc(v.msg || '')}</div><div class="tv">📺</div></div>` };
    },
    locked(v) {
      const pick = v.choices && v.picked != null ? v.choices.list.find((c) => c.i === v.picked) : null;
      const range = v.type === 'fourchette' && typeof v.picked === 'number' ? PQA.fmtVal(v.picked, v.unite) : '';
      return { key: 'locked' + v.qid + v.msg + tvKey(v), html: `${timerBar()}${tvQuestion(v, false)}<div class="wait"><div class="lock-icon">🔒</div><div class="wtitle">${esc(v.msg)}</div>${pick ? `<div class="picked-txt c${pick.i}">${esc(pick.text)}</div>` : ''}${range ? `<div class="picked-txt">${range}</div>` : ''}</div>` };
    },
    choices(v) {
      return {
        key: 'choices' + v.qid + JSON.stringify(v.choices),
        html: `${timerBar()}<div class="pq">${v.buzzed ? '<div class="you-buzzed">🔔 À toi ! Choisis vite !</div>' : ''}<div class="pq-text">${esc(v.question)}</div>${choiceBtns(v, 'answer')}</div>`,
      };
    },
    text(v) {
      return {
        key: 'text' + v.qid,
        html: `${timerBar()}<div class="pq">${v.buzzed ? '<div class="you-buzzed">🔔 À toi ! Quelle est ta réponse ?</div>' : ''}<div class="pq-text">${esc(v.question)}</div>
          <form id="f-text" class="ptext"><input id="in-answer" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="60" placeholder="Ta réponse..."><button class="big-btn green">ENVOYER</button></form></div>`,
        after() {
          const inp = $('#in-answer');
          setTimeout(() => inp.focus(), 50);
          $('#f-text').onsubmit = (e) => { e.preventDefault(); const val = inp.value.trim(); if (!val) return; net.send({ t: 'answer', value: val }); PQA.vibrate(30); inp.blur(); };
        },
      };
    },
    oral(v) {
      return { key: 'oral' + v.qid, html: `${timerBar()}<div class="wait"><div class="mic">🎤</div><div class="wtitle">Réponds à voix haute !</div><div class="wmsg">Le présentateur valide ta réponse.</div></div>` };
    },
    range(v) { return rangeScreen(v); },
    buzzer(v) {
      const st = v.me.frozen ? 'frozen' : v.buzz;
      const label = st === 'open' ? 'BUZZ !' : st === 'early' ? '⏳' : st === 'blocked' ? '⛔' : st === 'locked' ? '🔒' : st === 'frozen' ? '🧊' : '';
      const miss = v.penalty === 0 ? 'Une erreur laisse la main à l’adversaire.' : `${v.value ? 'Bonne réponse = +' + v.value + ', buzz' : 'Buzz'} raté = −${v.penalty || 100}.`;
      const sub = st === 'locked' ? (v.penalty === 0 ? 'Raté ! La main passe à l’adversaire.' : `Raté ! −${v.penalty || 100} et bloqué pour cette question.`) : st === 'other' ? `${esc(v.buzzer)} a buzzé !`
        : st === 'frozen' ? `Gelé ! (${v.me.frozen} s)` : st === 'blocked' ? 'Faux départ ! Buzzer bloqué 2 s.'
        : st === 'early' ? 'Lis la question… Buzzer trop tôt = bloqué 2 s !'
        : (v.clue ? `Indice : ${esc(v.clue)}<br>` : '') + `${miss} Tu auras ${v.answerSecs || 5} s pour répondre.`;
      return {
        key: 'buzz' + v.qid + st + (v.buzzer || '') + (st === 'frozen' ? v.me.frozen : '') + tvKey(v),
        html: `${timerBar()}${v.cat && !v.tv ? `<div class="pq-cat">${esc(v.cat)}${v.sub ? `<span class="pq-sub">${esc(v.sub)}</span>` : ''}</div>` : ''}${tvQuestion(v)}<div class="buzz-wrap ${st}" ${st === 'other' ? `style="--oc:${v.buzzerColor}"` : ''}>
          <button class="buzzer ${st}" id="buzzer" ${st !== 'open' && st !== 'early' ? 'disabled' : ''}><span>${label}</span></button>
          <div class="buzz-sub" id="buzz-sub">${sub}</div></div>`,
        after() {
          const b = $('#buzzer');
          const press = (e) => {
            e.preventDefault();
            if (state.pressed || b.disabled) return;
            state.pressed = true;
            b.classList.add('pressed');
            PQA.vibrate(60);
            net.send({ t: 'buzz' });
          };
          b.addEventListener('touchstart', press, { passive: false });
          b.addEventListener('mousedown', press);
        },
      };
    },
    level(v) {
      return {
        key: 'level' + v.cat,
        html: `${timerBar()}<div class="pq"><div class="pq-cat">${v.icon} ${esc(v.cat)}</div><div class="pq-text">Choisis ton niveau !</div>
          <div class="levels">${Array.from({ length: 10 }, (_, i) => `<button data-act="level" data-val="${i + 1}" class="lv${i + 1}">${i + 1}<small>${(i + 1) * 20} pts</small></button>`).join('')}</div>
          <div class="hint">1 = facile, 10 = expert. Tu ne vois la question qu’après !</div></div>`,
      };
    },
    pick(v) {
      return {
        key: 'pick' + v.cells.filter((c) => c.used).length,
        html: `${timerBar()}<div class="pq"><div class="pq-text">Choisis une case mystère !</div>
          <div class="pboard" style="--cols:${v.cols}">${v.cells.map((c) => `<button data-act="pick" data-val="${c.i}" ${c.used ? 'disabled' : ''}>${c.used ? c.icon : '🎁'}<small>${c.used ? '' : c.i + 1}</small></button>`).join('')}</div>
          <div class="hint">Le thème et la valeur restent secrets jusqu’au choix !</div></div>`,
      };
    },
    target(v) {
      return {
        key: 'target' + v.title,
        html: `${timerBar()}<div class="pq"><div class="pq-text">${esc(v.title)}</div><div class="plist">${v.targets.map((o) => `<button data-act="${v.action}" data-val="${o.id}" style="--oc:${o.color}">${esc(o.name)}</button>`).join('')}</div></div>`,
      };
    },
    themes(v) {
      return {
        key: 'themes' + v.themes.map((t) => t.by || '').join(','),
        html: `${timerBar()}<div class="pq"><div class="pq-text">Choisis ton thème pour le 4 à la suite !</div><div class="pthemes">${v.themes.map((t, i) => `<button data-act="theme" data-val="${i}" ${t.by ? 'disabled' : ''}>${t.icon}<span>${esc(t.name)}</span>${t.by ? `<small>pris par ${esc(t.by)}</small>` : ''}</button>`).join('')}
          <button class="mystery" data-act="theme" data-val="-1">❓<span>Thème mystère</span><small>surprise !</small></button></div></div>`,
      };
    },
    result(v) {
      const c = v.correct;
      const gain = v.hit ? `+1 ★ <small>(${v.stars}/${v.target})</small>` : '+' + fmt(v.pts);
      const head = c === true ? `<div class="res-ok">✔ BRAVO !</div><div class="res-pts">${gain}</div>` : c === false ? `<div class="res-ko">${v.none ? '⏱ Trop tard !' : '✖ RATÉ !'}</div>` : '<div class="wtitle">Réponse :</div>';
      const guess = v.guess ? `<div class="wmsg">Ta réponse : <b>${esc(v.guess)}</b>${v.exact ? ' · 🎯 PILE !' : v.gap ? ' · écart : ' + esc(v.gap) : ''}</div>` : '';
      return {
        key: 'result' + v.phase + c + v.pts + (v.stars || '') + v.answer + (v.guess || '') + tvKey(v),
        html: `<div class="wait result ${c === true ? 'good' : c === false ? 'bad' : ''}">${v.tv && v.tv.q ? `<div class="tvq-text small">${esc(v.tv.q.question)}</div>` : ''}${head}<div class="res-answer">${esc(v.answer)}</div>${guess}${tvResults(v)}${v.anecdote ? `<div class="res-anec">💡 ${esc(v.anecdote)}</div>` : ''}</div>`,
      };
    },
    end(v) {
      const m = v.me;
      return {
        key: 'end' + m.rank + v.title,
        html: `<div class="wait end"><div class="end-rank">${m.rank === 1 ? '🏆' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : '🎖️'} ${m.rank}${m.rank === 1 ? 'er' : 'e'}</div>
          <img class="pix av-big" src="${PQA.avatarURL(m.avatar, m.color, m.rank === 1 ? 'happy' : 'idle', 8)}" alt="">
          <div class="wtitle">« ${esc(v.title)} »</div><div class="wmsg">${esc(v.desc)}</div><div class="res-pts">${fmt(m.score)} pts</div>
          ${v.winnerTeam ? `<div class="wmsg">Victoire des ${esc(v.winnerTeam)} !</div>` : ''}${v.tv ? tvRanking(v) : ''}</div>`,
      };
    },
  };

  /* ======================= Mode téléphones : ce que montrerait la TV ======== */
  const tvKey = (v) => (v.tv ? JSON.stringify([v.tv.q, v.tv.rules, v.tv.results]) : '');
  function tvQuestion(v, withChoices = true) {
    const t = v.tv && v.tv.q;
    if (!t) return '';
    const n = t.choices ? t.choices.length : 0;
    const shown = t.correctIdx != null;
    return `<div class="tvq"><div class="tvq-cat">${esc(t.cat)}${t.sub ? `<span class="tvq-sub">${esc(t.sub)}</span>` : ''}</div><div class="tvq-text">${esc(t.question)}</div>
      ${t.clues ? `<ol class="tvq-clues">${t.clues.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
      ${withChoices && n ? `<div class="tvq-choices n${n}">${t.choices.map((c, i) => `<span class="c${i} ${shown ? (i === t.correctIdx ? 'good' : 'bad') : ''}"><b>${n === 2 ? (i === 0 ? '✔' : '✖') : LETTERS[i]}</b>${esc(c)}</span>`).join('')}</div>` : ''}</div>`;
  }
  function tvRanking(v) {
    const t = v.tv;
    const teams = t.teams ? `<div class="tv-rank teams">${t.teams.map((x, i) => `<div style="--pc:${x.color}"><i>${i + 1}</i><span>Équipe des ${esc(x.name)}</span><b>${fmt(x.score)}</b></div>`).join('')}</div>` : '';
    return teams + `<div class="tv-rank">${t.rank.map((p, i) => `<div class="${p.id === v.me.id ? 'me' : ''}" style="--pc:${p.color}"><i>${i + 1}</i><span>${p.bot ? '🤖 ' : ''}${esc(p.name)}</span><b>${fmt(p.score)}</b></div>`).join('')}</div>`;
  }
  function tvResults(v) {
    const r = v.tv && v.tv.results;
    if (!r || !r.length) return '';
    return `<div class="tv-res">${r.map((x) => `<span class="${x.ok ? 'ok' : x.none ? 'none' : 'ko'}" style="--pc:${x.color}">${x.ok ? '✔' : x.none ? '⏱' : '✖'} ${esc(x.name)}${x.ok && x.pts ? ' +' + fmt(x.pts) : ''}</span>`).join('')}</div>`;
  }
  let pixouSrc = null;
  function pixouImg() {
    if (pixouSrc == null) {
      try { const c = document.createElement('canvas'); c.width = 52; c.height = 70; PQA.drawPresenter(c.getContext('2d'), 0, 0, 2, 'happy', false, 0); pixouSrc = c.toDataURL(); } catch (e) { pixouSrc = ''; }
    }
    return pixouSrc;
  }
  /** Bandeau des scores et bulle de Pixou, en haut de l'écran (mode téléphones). */
  function renderTV(v) {
    const t = v.tv;
    const strip = t && v.phase !== 'lobby' ? (t.teams || t.rank).map((p, i) => `<span class="${p.id === v.me.id ? 'me' : ''}" style="--pc:${p.color}">${i + 1}. ${esc(t.teams ? p.name : p.name)} <b>${fmt(p.score)}</b></span>`).join('') : '';
    patch($('#scores'), strip);
    const say = t && t.say && v.phase !== 'lobby' ? t.say : '';
    const el = $('#pixou-say');
    if (el.dataset.say !== say) {
      el.dataset.say = say;
      el.innerHTML = say ? `<img class="pix" src="${pixouImg()}" alt=""><span>${esc(say)}</span>` : '';
      el.classList.remove('pop'); void el.offsetWidth; if (say) el.classList.add('pop');
    }
  }

  /* ======================= Mode téléphones : panneau de l'hôte ============== */
  const ownSend = (act, extra = {}) => { net.send({ t: 'owner', act, ...extra }); PQA.vibrate(15); };
  function ownerLobby(v) {
    const o = v.owner;
    const seg = (key, opts, cur, disabled = []) => `<div class="oseg">${opts.map(([val, l]) => `<button data-own="set" data-key="${key}" data-val="${val}" class="${String(cur) === String(val) ? 'on' : ''}" ${disabled.includes(val) ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    const duel = o.mode === 'duel', solo = o.mode === 'solo';
    const humans = o.players.length, n = humans + o.bots.length;
    const share = `Viens jouer à PIXEL QUIZ ARENA avec moi ! Code de la salle : ${o.code}`;
    const players = o.players.map((p) => `<div class="oplayer" style="--pc:${p.color}">
        ${o.teams ? `<button class="oteam" data-own="team" data-pid="${p.id}" style="background:${TEAM_COLORS[p.team] || '#888'}" title="Changer d’équipe"></button>` : ''}
        <span>${esc(p.name)}${p.me ? ' (toi)' : ''}${p.on ? '' : ' 💤'}</span>${p.me ? '' : `<button class="ox" data-own="kick" data-pid="${p.id}" data-name="${esc(p.name)}">✖</button>`}</div>`).join('');
    const bots = solo ? `<div class="orow"><label>Ordis</label><div class="obots">${o.bots.map((b) => `<div class="obot" style="--pc:${b.color}"><b>🤖 ${esc(b.name)}</b><div class="oseg">${o.levels.map((L) => `<button data-own="botlevel" data-pid="${b.id}" data-val="${L.id}" class="${b.level === L.id ? 'on' : ''}" title="${esc(L.name)}">${L.icon}</button>`).join('')}</div><button class="ox" data-own="kick" data-pid="${b.id}">✖</button></div>`).join('')}
        <button class="oadd" data-own="botadd">＋ Ajouter un ordi</button></div></div>` : '';
    const canStart = duel ? n === 2 : solo ? o.bots.length > 0 : n >= 1;
    return {
      key: 'owner' + JSON.stringify(o) + JSON.stringify(v.me.avatar) + v.me.name,
      keepScroll: true,
      html: `<div class="opanel">
        <div class="obox share">
          <div class="olbl">Invite tes amis</div>
          <div class="ocode">${esc(o.code)}</div>
          <div class="ohint">Ils ouvrent le lien (même à distance), ou scannent le QR code, ou tapent le code sur <b>${esc(o.url.replace(/^https?:\/\//, '').replace(/play\.html.*$/, 'play'))}</b></div>
          <div class="oshare">
            <button data-share="native">📤 Partager</button>
            <a href="https://wa.me/?text=${encodeURIComponent(share + ' ' + o.url)}" target="_blank" rel="noopener">🟢 WhatsApp</a>
            <button data-share="copy">📋 Copier le lien</button>
            <button data-share="qr">🔳 QR code</button>
          </div>
          <div class="oqr" id="oqr"></div>
        </div>
        <div class="obox"><div class="olbl">Joueurs (${n} / ${duel ? 2 : 10})</div><div class="oplayers">${players}</div>
          ${o.teams ? '<button class="oadd" data-own="shuffleteams">🔀 Mélanger les équipes</button>' : ''}</div>
        <div class="obox">
          <div class="orow"><label>Mode</label>${seg('mode', [['virtual', '🎯 Classique'], ['duel', '🥊 Duel'], ['solo', '🎮 Avec des ordis']], o.mode)}</div>
          ${bots}
          ${duel || solo ? '' : `<div class="orow"><label>Équipes</label>${seg('teams', [[0, 'Non'], [2, '2'], [3, '3'], [4, '4']], o.teams)}</div>`}
          ${duel ? '' : `<div class="orow"><label>Manches</label><div class="ochips">${o.allRounds.map((r) => `<button data-own="round" data-val="${r.id}" class="${o.rounds.includes(r.id) ? 'on' : ''}">${r.icon} ${esc(r.name)}</button>`).join('')}</div></div>
          <div class="orow"><label>Durée</label>${seg('length', [['court', 'Courte'], ['normal', 'Normale'], ['long', 'Longue']], o.length)}</div>
          <div class="orow"><label>Coups bas</label>${seg('cards', [['1', '🃏 Oui'], ['0', 'Non']], o.cards ? '1' : '0')}</div>`}
          <div class="orow"><label>Pixou dans le chat</label>${seg('pixou', [['on', '🎙️ Il clashe'], ['off', '🤐 Il se tait']], o.pixou)}</div>
        </div>
        <button class="big-btn green ${canStart ? '' : 'disabled'}" data-own="start">▶ LANCER LA PARTIE</button>
        <button class="small-btn" id="btn-edit">✏️ Modifier mon profil</button>
      </div>`,
      after() {
        $('#btn-edit').onclick = () => { state.editing = true; showJoin(); };
        $$('[data-share]').forEach((b) => (b.onclick = async () => {
          const how = b.dataset.share;
          if (how === 'native' && navigator.share) { try { await navigator.share({ title: 'PIXEL QUIZ ARENA', text: share, url: o.url }); } catch (e) {} return; }
          if (how === 'qr') {
            const box = $('#oqr');
            if (box.innerHTML) { box.innerHTML = ''; return; }
            try { const q = qrcode(0, 'M'); q.addData(o.url); q.make(); box.innerHTML = `<img src="${q.createDataURL(6, 2)}" alt="QR code">`; } catch (e) { toast('QR code indisponible'); }
            return;
          }
          try { await navigator.clipboard.writeText(o.url); toast('Lien copié ! Colle-le dans ta conversation.'); }
          catch (e) { window.prompt('Copie ce lien :', o.url); }
        }));
      },
    };
  }
  const TEAM_COLORS = (PQA.PALETTE && PQA.PALETTE.team) || [];
  /** Commandes de l'hôte pendant la partie (mode téléphones). */
  function renderOwnerBar(v) {
    const o = v.owner;
    let html = '';
    if (o && v.phase === 'end') html = '<button data-own="lobby">🔁 Nouvelle partie</button>';
    else if (o && v.phase !== 'lobby') {
      html = `<button data-own="pause">${o.paused ? '▶ Reprendre' : '⏸ Pause'}</button>
        <button data-own="next">⏭ Suivant</button>
        <button data-own="quit">🏠 Quitter</button>`;
    }
    if (o) html += `<button data-own="sound" aria-pressed="${!o.muted}">${o.muted ? '🔇 Activer le son' : '🔊 Couper le son'}</button>`;
    patch($('#ownerbar'), html);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-own]');
    if (!b || b.disabled) return;
    const act = b.dataset.own;
    if (act === 'kick' && b.dataset.name && !confirm('Retirer ' + b.dataset.name + ' de la partie ?')) return;
    if (act === 'quit') { if (confirm('Quitter la partie et revenir au salon ? Les scores seront perdus.')) ownSend('lobby'); return; }
    ownSend(act, { key: b.dataset.key, val: b.dataset.val, pid: b.dataset.pid });
  });

  /* ======================= Chat ===================================== */
  const EMOJIS = ['👏', '😂', '😱', '🔥', '🤔', '😭', '👀', '🍿'];
  const chat = { list: [], open: false, unread: 0 };
  function chatLine(m) {
    const mine = m.pid && m.pid === state.myId;
    return `<div class="cmsg ${m.who === 'pixou' ? 'pixou' : ''} ${mine ? 'mine' : ''}" style="--pc:${m.color || 'var(--yellow)'}">
      ${m.who === 'pixou' ? `<img class="pix" src="${pixouImg()}" alt="">` : ''}<div><b>${m.who === 'pixou' ? 'PIXOU' : esc(m.name)}</b><span>${esc(m.text)}</span></div></div>`;
  }
  function chatRender() {
    const el = $('#chat-list');
    el.innerHTML = chat.list.length ? chat.list.map(chatLine).join('') : '<div class="cempty">Aucun message pour l’instant. Dis bonjour… Pixou adore qu’on lui parle.</div>';
    el.scrollTop = el.scrollHeight;
    const badge = $('#chat-badge');
    badge.textContent = chat.unread > 9 ? '9+' : chat.unread || '';
    badge.classList.toggle('on', chat.unread > 0);
  }
  function chatAdd(m, quiet) {
    if (!m || chat.list.some((x) => x.id === m.id)) return;
    chat.list.push(m);
    if (chat.list.length > 60) chat.list.shift();
    if (quiet) return;
    if (!chat.open && m.pid !== state.myId) {
      chat.unread++;
      if (m.who === 'pixou' || chat.unread === 1) peek(m);
    }
    chatRender();
  }
  let peekTimer = null;
  function peek(m) {
    const el = $('#chat-peek');
    el.innerHTML = chatLine(m);
    el.classList.add('on');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => el.classList.remove('on'), m.who === 'pixou' ? 6000 : 3500);
  }
  function chatOpen(on) {
    chat.open = on;
    document.body.classList.toggle('chat-open', on);
    $('#chat').setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) { chat.unread = 0; $('#chat-peek').classList.remove('on'); }
    chatRender();
  }
  function chatSend(text) {
    text = String(text || '').trim();
    if (!text) return;
    net.send({ t: 'chat', text: text.slice(0, 140) });
    PQA.vibrate(10);
  }
  $('#chat-emojis').innerHTML = EMOJIS.map((x) => `<button data-emo="${x}">${x}</button>`).join('');
  $('#chat-emojis').addEventListener('click', (e) => { const b = e.target.closest('[data-emo]'); if (b) chatSend(b.dataset.emo); });
  $('#chat-btn').onclick = () => chatOpen(!chat.open);
  $('#chat-peek').onclick = () => chatOpen(true);
  $('#chat-close').onclick = () => chatOpen(false);
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); const i = $('#chat-in'); chatSend(i.value); i.value = ''; };

  /* ---- Fourchette : une seule valeur, il faut viser pile ---- */
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }
  function rangeScreen(v) {
    const [lo, hi] = v.bornes || [0, 1000];
    const span = hi - lo;
    const log = lo > 0 && hi / lo >= 1000; // échelle logarithmique pour les très grands écarts
    const step = v.step || (span <= 3000 && Number.isInteger(lo) && Number.isInteger(hi) ? 1 : niceStep(span / 1000));
    const SL = 1000;
    const toVal = (s) => {
      let x = log ? lo * Math.pow(hi / lo, s / SL) : lo + (span * s) / SL;
      x = Math.round(x / step) * step;
      if (log) { const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))) - 1); x = Math.round(x / mag) * mag; }
      return Math.max(lo, Math.min(hi, Number(x.toFixed(6))));
    };
    const toSl = (x) => (log ? (Math.log(x / lo) / Math.log(hi / lo)) * SL : ((x - lo) / span) * SL);
    return {
      key: 'range' + v.qid,
      html: `${timerBar()}<div class="pq"><div class="pq-text">${esc(v.question)}</div>
        <div class="prange">
          <div class="pr-big"><input id="n-val" inputmode="decimal"><span>${v.unite && v.unite !== 'année' ? esc(v.unite) : ''}</span></div>
          <div class="pr-row"><input type="range" id="r-val" min="0" max="${SL}" value="${SL / 2}"></div>
          <div class="pr-fine"><button data-d="-10">−−</button><button data-d="-1">−</button><button data-d="1">+</button><button data-d="10">++</button></div>
          <div class="hint">Vise pile ! Plus tu es proche de la réponse, plus tu marques.${v.unite ? ' Unité : <b>' + esc(v.unite) + '</b>' : ''}</div>
          <button class="big-btn green" id="btn-range">VALIDER</button>
        </div></div>`,
      after() {
        const rv = $('#r-val'), nv = $('#n-val');
        let val = toVal(Number(rv.value));
        const show = (from) => {
          if (from !== 'num') nv.value = v.unite === 'année' ? String(val) : fmt(val).replace(/[\u202f\u00a0]/g, ' ');
          rv.value = toSl(val);
        };
        rv.oninput = () => { val = toVal(Number(rv.value)); show(); };
        const parse = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));
        nv.oninput = () => { const x = parse(nv.value); if (isFinite(x) && nv.value.trim() !== '') { val = x; show('num'); } };
        nv.onchange = () => { const x = parse(nv.value); if (isFinite(x)) val = x; show(); };
        $$('.pr-fine button').forEach((b) => (b.onclick = () => {
          const st = log ? Math.max(step, Math.pow(10, Math.floor(Math.log10(Math.max(1, Math.abs(val)))) - 1)) : step;
          val = Number((val + st * Number(b.dataset.d)).toFixed(6));
          show(); PQA.vibrate(8);
        }));
        $('#btn-range').onclick = () => { const x = parse(nv.value); if (isFinite(x)) val = x; net.send({ t: 'answer', value: val }); PQA.vibrate(40); };
        show();
      },
    };
  }

  /* ======================= Actions ================================ */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) {
      const act = b.dataset.act, val = b.dataset.val;
      const num = Number(val);
      if (act === 'answer') { net.send({ t: 'answer', value: num }); PQA.vibrate(30); $$('.pchoice').forEach((x) => x.classList.toggle('picked', x === b)); }
      else if (act === 'level') { net.send({ t: 'level', value: num }); PQA.vibrate(30); }
      else if (act === 'pick') { net.send({ t: 'pick', value: num }); PQA.vibrate(30); }
      else if (act === 'theme') { net.send({ t: 'theme', value: num }); PQA.vibrate(30); }
      else if (act === 'target') { net.send({ t: 'target', value: val }); PQA.vibrate(30); }
      return;
    }
    const c = e.target.closest('.card-btn');
    if (c) openCard(c.dataset.card);
  });

  function openCard(card) {
    const def = PQA.CARDS[card];
    const v = state.view;
    if (!v) return;
    const targets = def.target ? `<div class="plist">${v.others.map((o) => `<button data-target="${o.id}" style="--oc:${o.color}">${esc(o.name)}</button>`).join('')}</div>` : '<button class="big-btn" data-target="">UTILISER</button>';
    modal(`<div class="m-title">${def.icon} ${esc(def.name)}</div><div class="m-desc">${esc(def.desc)}</div>${def.target ? '<div class="m-desc">Sur qui ?</div>' : ''}${targets}<button class="small-btn" data-close>Garder pour plus tard</button>`, (el) => {
      el.querySelectorAll('[data-target]').forEach((b) => (b.onclick = () => { net.send({ t: 'card', card, target: b.dataset.target || null }); PQA.vibrate([30, 30, 60]); closeModal(); }));
    });
  }
  function modal(html, bind) {
    const el = $('#modal');
    el.innerHTML = `<div class="m-box">${html}</div>`;
    el.classList.add('on');
    el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
    bind && bind(el);
  }
  function closeModal() { $('#modal').classList.remove('on'); $('#modal').innerHTML = ''; }

  /* ======================= Effets ================================= */
  function flash(color, dur = 500) {
    const el = $('#flash');
    el.style.background = color;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }
  function fx(m) {
    if (m.fx === 'good') { flash('#38b764'); PQA.vibrate([40, 40, 40]); }
    else if (m.fx === 'wrong') { flash('#e43b44'); PQA.vibrate(350); document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake'); }
    else if (m.fx === 'buzzwin') { flash(state.view ? state.view.me.color : '#fff'); PQA.vibrate([100, 50, 150]); }
    else if (m.fx === 'falsestart') { flash('#e43b44'); PQA.vibrate([200, 80, 200]); }
    else if (m.fx === 'frozen') { $('#ice').classList.add('on'); PQA.vibrate([20, 20, 20, 20, 20]); setTimeout(() => $('#ice').classList.remove('on'), 5000); }
    else if (m.fx === 'card') { toast('🃏 Nouvelle carte : ' + PQA.CARDS[m.card].name + ' !'); PQA.vibrate([30, 30, 30]); }
  }
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'ptoast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---- Chrono local (calé sur le temps restant envoyé par le plateau) ---- */
  function loop() {
    requestAnimationFrame(loop);
    const f = document.getElementById('ptimer-fill');
    if (!f) return;
    if (!state.deadline || !state.total || (state.view && state.view.paused)) { f.parentElement.style.visibility = state.deadline ? 'visible' : 'hidden'; return; }
    const left = Math.max(0, state.deadline - performance.now());
    f.style.width = (left / state.total) * 100 + '%';
    f.classList.toggle('hurry', left < 5000);
    f.parentElement.style.visibility = 'visible';
  }
  requestAnimationFrame(loop);

  // Démarrage : reconnexion directe si on a déjà un jeton pour cette salle.
  if (state.room && state.token && state.name) {
    showConnecting(`Retour dans la salle ${esc(state.room)}...`);
    net.connect(state.room);
  } else showJoin();
})();

