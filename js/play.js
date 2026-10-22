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
  if (LOCAL) document.body.classList.add('local-pad');
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
    getHello: () => ({ t: 'hello', role: 'player', token: state.token, name: state.name, avatar: state.avatar, v: 1 }),
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
        PQA._wantAwake = true; PQA.keepAwake();
        return;
      }
      if (m.t === 'error') { net.stop(); state.joined = false; showJoin(m.text); return; }
      if (m.t === 'view') {
        state.view = m.v;
        if (m.left != null) { state.deadline = performance.now() + m.left; state.total = m.v.timer ? m.v.timer.total : 0; }
        else state.deadline = 0;
        render();
        return;
      }
      if (m.t === 'fx') return fx(m);
      if (m.t === 'toast') return toast(m.text);
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
    const out = screens[v.screen] ? screens[v.screen](v) : screens.wait(v);
    document.body.dataset.screen = v.screen;
    document.body.style.setProperty('--me', v.me.color);
    if (LOCAL) padSize(v.screen);
    if (out.key !== state.renderKey) {
      state.renderKey = out.key;
      state.pressed = false;
      $('#screen').innerHTML = out.html;
      out.after && out.after();
    } else if (out.parts) {
      for (const id in out.parts) patch(document.getElementById(id), out.parts[id]);
    }
  }

  function renderMe(v) {
    const m = v.me;
    const team = m.teamName ? `<span class="team" style="background:${m.teamColor}">${esc(m.teamName)}</span>` : '';
    patch($('#me'), `<img class="pix av" src="${PQA.avatarURL(m.avatar, m.color, 'idle', 4)}" alt="">
      <div class="me-info"><b style="color:${m.color}">${esc(m.name)}</b>${team}<small>${m.rank}${m.rank === 1 ? 'er' : 'e'} / ${m.total}${m.streak >= 3 ? ` · 🔥x${m.mult}` : ''}${m.double ? ' · ✖️2' : ''}</small></div>
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
        key: 'lobby' + m.name + JSON.stringify(m.avatar) + m.team + m.color,
        html: `<div class="wait lobby">
          <img class="pix av-big" src="${PQA.avatarURL(m.avatar, m.color, 'happy', 8)}" alt="">
          <div class="wtitle">Tu es sur le plateau !</div>
          ${m.teamName ? `<div class="team big" style="background:${m.teamColor}">Équipe des ${esc(m.teamName)}</div>` : ''}
          <div class="wmsg">Regarde l’écran, l’émission va commencer.</div>
          <button class="small-btn" id="btn-edit">✏️ Modifier mon profil</button>
        </div>`,
        after() { $('#btn-edit').onclick = () => { state.editing = true; showJoin(); }; },
      };
    },
    wait(v) {
      return { key: 'wait' + v.title + v.msg + v.phase, html: `<div class="wait"><div class="wtitle">${esc(v.title || 'Regarde l’écran !')}</div><div class="wmsg">${esc(v.msg || '')}</div><div class="tv">📺</div></div>` };
    },
    locked(v) {
      const pick = v.choices && v.picked != null ? v.choices.list.find((c) => c.i === v.picked) : null;
      const range = v.type === 'fourchette' && typeof v.picked === 'number' ? PQA.fmtVal(v.picked, v.unite) : '';
      return { key: 'locked' + v.qid + v.msg, html: `${timerBar()}<div class="wait"><div class="lock-icon">🔒</div><div class="wtitle">${esc(v.msg)}</div>${pick ? `<div class="picked-txt c${pick.i}">${esc(pick.text)}</div>` : ''}${range ? `<div class="picked-txt">${range}</div>` : ''}</div>` };
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
      const miss = v.penalty === 0 ? 'Une erreur laisse la main à l’adversaire.' : `Buzz raté = −${v.penalty || 100}.`;
      const sub = st === 'locked' ? (v.penalty === 0 ? 'Raté ! La main passe à l’adversaire.' : `Raté ! −${v.penalty || 100} et bloqué pour cette question.`) : st === 'other' ? `${esc(v.buzzer)} a buzzé !`
        : st === 'frozen' ? `Gelé ! (${v.me.frozen} s)` : st === 'blocked' ? 'Faux départ ! Buzzer bloqué 2 s.'
        : st === 'early' ? 'Lis la question… Buzzer trop tôt = bloqué 2 s !'
        : (v.clue ? `Indice : ${esc(v.clue)}<br>` : '') + `${miss} Tu auras ${v.answerSecs || 5} s pour répondre.`;
      return {
        key: 'buzz' + v.qid + st + (v.buzzer || '') + (st === 'frozen' ? v.me.frozen : ''),
        html: `${timerBar()}${v.cat ? `<div class="pq-cat">${esc(v.cat)}</div>` : ''}<div class="buzz-wrap ${st}" ${st === 'other' ? `style="--oc:${v.buzzerColor}"` : ''}>
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
      const head = c === true ? `<div class="res-ok">✔ BRAVO !</div><div class="res-pts">+${fmt(v.pts)}</div>` : c === false ? `<div class="res-ko">${v.none ? '⏱ Trop tard !' : '✖ RATÉ !'}</div>` : '<div class="wtitle">Réponse :</div>';
      const guess = v.guess ? `<div class="wmsg">Ta réponse : <b>${esc(v.guess)}</b>${v.exact ? ' · 🎯 PILE !' : v.gap ? ' · écart : ' + esc(v.gap) : ''}</div>` : '';
      return {
        key: 'result' + v.phase + c + v.pts + v.answer + (v.guess || ''),
        html: `<div class="wait result ${c === true ? 'good' : c === false ? 'bad' : ''}">${head}<div class="res-answer">${esc(v.answer)}</div>${guess}${v.anecdote ? `<div class="res-anec">💡 ${esc(v.anecdote)}</div>` : ''}</div>`,
      };
    },
    end(v) {
      const m = v.me;
      return {
        key: 'end' + m.rank + v.title,
        html: `<div class="wait end"><div class="end-rank">${m.rank === 1 ? '🏆' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : '🎖️'} ${m.rank}${m.rank === 1 ? 'er' : 'e'}</div>
          <img class="pix av-big" src="${PQA.avatarURL(m.avatar, m.color, m.rank === 1 ? 'happy' : 'idle', 8)}" alt="">
          <div class="wtitle">« ${esc(v.title)} »</div><div class="wmsg">${esc(v.desc)}</div><div class="res-pts">${fmt(m.score)} pts</div>
          ${v.winnerTeam ? `<div class="wmsg">Victoire des ${esc(v.winnerTeam)} !</div>` : ''}</div>`,
      };
    },
  };

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
