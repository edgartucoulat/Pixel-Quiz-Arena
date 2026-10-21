/* =========================================================================
 * PIXEL QUIZ ARENA - Affichage de l'Écran Plateau
 * Rendu du plateau à partir de l'état du moteur (PQA.Game), animations,
 * sons, présentateur virtuel et public.
 * Le plateau est dessiné dans une scène fixe de 1600x900 mise à l'échelle.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});
  const { esc, patch, $, fmt } = PQA;
  const sfx = PQA.sfx;
  const music = PQA.music;
  const voice = PQA.voice;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const avatarImg = (p, pose, cls = '') => `<img class="pix av ${cls}" src="${PQA.avatarURL(p.avatar, p.color, pose)}" alt="">`;
  const diffBar = (d) => `<span class="diff" title="Difficulté ${d}/10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < d ? 'on' : ''} ${i >= 7 ? 'hard' : i >= 3 ? 'mid' : ''}"></i>`).join('')}</span>`;

  class HostUI {
    constructor(game) {
      this.g = game;
      this.app = $('#app');
      this.stage = $('#stage');
      this.stageKey = null;
      this.prefs = this.loadPrefs();
      this.audience = new PQA.Audience($('#audience'));
      this.pcv = $('#presenter-cv');
      this.pctx = this.pcv.getContext('2d');
      this.expr = 'happy';
      this.typing = null;
      this.particles = [];
      this.fxc = $('#fx').getContext('2d');
      this.lastTickSec = null;
      this.scoreShown = {};
      this.wheelDone = null;
      window.addEventListener('resize', () => this.fit());
      this.fit();
      this.buildSoundPanel();
      voice.onTalk = (on) => music.setDuck(on);
      voice.onVoices = () => this.refreshSoundPanel();
      this.applyPrefs();
      this.bind();
      requestAnimationFrame((t) => this.loop(t));
    }

    /* ---- Préférences locales de l'écran (son, CRT, voix) ---- */
    loadPrefs() {
      const def = { crt: true, tts: true, muted: false, volume: 0.6, music: 0.45, voiceVol: 1, voice: 'auto', robot: false };
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('pqa_prefs') || '{}') || {}; } catch (e) {}
      // Anciennes préférences : la voix était coupée par défaut car robotique.
      if (saved.music == null) { delete saved.tts; if (saved.volume === 0) { saved.volume = 0.6; saved.muted = true; } }
      return Object.assign(def, saved);
    }
    savePrefs() { try { localStorage.setItem('pqa_prefs', JSON.stringify(this.prefs)); } catch (e) {} this.applyPrefs(); }
    applyPrefs() {
      const pr = this.prefs, off = !!pr.muted;
      document.body.classList.toggle('crt', !!pr.crt);
      sfx.setVolume(off ? 0 : pr.volume);
      music.setVolume(off ? 0 : pr.music);
      voice.volume = pr.voiceVol;
      voice.choice = pr.voice;
      voice.fallback = !!pr.robot;
      voice.pickLive();
      PQA.tts.enabled = !!pr.tts && !off && pr.voiceVol > 0;
      this.refreshSoundPanel();
    }

    /* ---- Panneau « Sons » : musique, effets, voix ---- */
    buildSoundPanel() {
      const el = (this.soundPanel = document.createElement('div'));
      el.id = 'sound-panel';
      el.innerHTML = `
        <div class="sp-title">🎚️ SONS</div>
        <label>🎵 Musique <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
        <label>💥 Effets <input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
        <label>🗣️ Voix <input type="range" min="0" max="1" step="0.05" data-k="voiceVol"></label>
        <label class="sp-row">Voix de Pixou <select data-k="voice"></select></label>
        <label class="sp-check"><input type="checkbox" data-k="robot"> Voix robotique en secours</label>
        <div class="sp-info"></div>
        <button class="ctl" data-sp="test">▶ Tester la voix</button>`;
      this.app.appendChild(el);
      el.addEventListener('input', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        this.prefs[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
        if (k === 'voiceVol' && this.prefs.voiceVol > 0) this.prefs.tts = true;
        this.savePrefs();
        if (k === 'volume') { sfx.unlock(); sfx.select(); }
      });
      el.addEventListener('click', (e) => {
        if (!e.target.closest('[data-sp="test"]')) return;
        sfx.unlock();
        voice.speak(PQA.line('question') + ' ' + 'Quel peintre a coupé une partie de son oreille gauche en 1888 ?', { kind: 'question' });
      });
    }
    refreshSoundPanel() {
      const el = this.soundPanel;
      if (!el) return;
      const pr = this.prefs;
      el.querySelectorAll('input[type=range]').forEach((i) => (i.value = pr[i.dataset.k]));
      el.querySelector('[data-k=robot]').checked = !!pr.robot;
      const sel = el.querySelector('select');
      const opts = [['auto', 'Automatique (la plus naturelle)']].concat(voice.voices.map((v) => [v.name, v.name + (voice.score(v) >= 80 ? ' ★' : '')]));
      sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      sel.value = opts.some(([v]) => v === pr.voice) ? pr.voice : 'auto';
      el.querySelector('.sp-info').textContent = 'En ce moment : ' + voice.description;
    }

    fit() {
      const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
      this.app.style.transform = `translate(-50%, -50%) scale(${s})`;
    }

    /* ---- Interactions (souris / clavier) ---- */
    bind() {
      document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        sfx.unlock();
        this.action(el.dataset.act, el.dataset);
      });
      document.addEventListener('keydown', (e) => {
        if (/INPUT|SELECT/.test(e.target.tagName)) return;
        const k = e.key.toLowerCase();
        const g = this.g;
        // Duel sur un seul écran : A et L pour buzzer, puis 1-4 (A) ou 7-0 (L).
        if (g.settings.localDuel && g.q && g.q.kind === 'buzz') {
          const local = g.activePlayers().filter((p) => p.local);
          const byKey = local.find((p) => p.key === k);
          if (byKey) { g.buzz(byKey.id); return; }
          const cur = g.q.buzz.current && g.players[g.q.buzz.current];
          if (cur && cur.local) {
            const keys = cur.key === 'a' ? ['1', '2', '3', '4'] : ['7', '8', '9', '0'];
            const alt = cur.key === 'a' ? ['q', 'w', 'e', 'r'] : ['u', 'i', 'o', 'p'];
            let i = keys.indexOf(k); if (i < 0) i = alt.indexOf(k);
            if (i >= 0 && i < g.q.choices.length) { g.answer(cur.id, i); return; }
          }
        }
        if (k === ' ' || k === 'enter' || k === 'arrowright') { e.preventDefault(); if (g.phase !== 'lobby') g.advance(); }
        if (k === 'p') g.togglePause();
        if (k === 'f') this.fullscreen();
      });
    }
    fullscreen() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    }
    action(act, d) {
      const g = this.g, s = g.settings;
      switch (act) {
        case 'set': {
          let v = d.val;
          if (d.key === 'teams') { g.setTeams(Number(v)); sfx.select(); return; }
          if (d.key === 'cards') v = v === '1';
          if (d.key === 'mode') {
            s.localDuel = false;
            if (v === 'duel' && g.activePlayers().length > 2) { this.toast('Le duel se joue à 2 : retire des joueurs d’abord.'); return; }
          }
          s[d.key] = v;
          sfx.select(); g.changed();
          return;
        }
        case 'round': {
          const i = s.rounds.indexOf(d.val);
          if (i >= 0) s.rounds.splice(i, 1); else s.rounds.push(d.val);
          sfx.select(); g.changed(); return;
        }
        case 'pref': {
          this.prefs[d.key] = !this.prefs[d.key];
          this.savePrefs(); sfx.select(); g.changed();
          if (d.key === 'tts' && this.prefs.tts) PQA.tts.speak('La voix du présentateur est activée !');
          return;
        }
        case 'localduel': s.localDuel = true; s.mode = 'duel'; g.addLocalPlayers(); return;
        case 'start': { const err = g.start(); if (err) this.toast(err); return; }
        case 'next': return g.advance();
        case 'pause': return g.togglePause();
        case 'fullscreen': return this.fullscreen();
        case 'sounds': this.soundPanel.classList.toggle('on'); this.refreshSoundPanel(); return;
        case 'team': return g.cycleTeam(d.pid);
        case 'shuffleteams': return g.shuffleTeams();
        case 'kick': if (confirm('Retirer ce joueur ?')) g.kick(d.pid); return;
        case 'resetseen': g.resetSeen(); this.toast('Historique des questions effacé.'); g.changed(); return;
        case 'override': return this.hooks.override(d.pid);
        case 'lobby': return this.hooks.backToLobby();
        case 'choice': {
          // Clic sur un choix : réponse du joueur local qui a buzzé (duel sur un écran)
          const cur = g.q && g.q.buzz && g.q.buzz.current && g.players[g.q.buzz.current];
          if (cur && cur.local) g.answer(cur.id, Number(d.i));
          return;
        }
        case 'localbuzz': return g.buzz(d.pid);
      }
    }
    toast(text) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      this.app.appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }

    /* ======================= Rendu ================================= */
    render() {
      const g = this.g;
      document.body.dataset.mode = g.settings.mode;
      document.body.dataset.phase = g.phase;
      this.renderTop();
      const fn = this['r_' + g.phase] || this.r_wait;
      const v = fn.call(this);
      if (v.key !== this.stageKey) {
        this.stage.innerHTML = v.html;
        this.stage.className = 'stage-' + g.phase + (g.round ? ' round-' + g.round.type : '');
        this.stageKey = v.key;
        v.after && requestAnimationFrame(() => requestAnimationFrame(v.after));
      }
      if (v.parts) for (const id in v.parts) patch(document.getElementById(id), v.parts[id]);
      this.renderPodiums();
      this.renderControls();
    }

    renderTop() {
      const g = this.g, r = g.round;
      let center = '';
      if (r && g.phase !== 'lobby' && g.phase !== 'end') {
        const R = PQA.ROUNDS[r.type];
        const total = g.rounds.length;
        center = r.type === 'duel' ? `<span class="tb-round">${R.icon} ${esc(R.short)}</span><span class="tb-count">Round ${r.n || 1}</span>` : `<span class="tb-round">${R.icon} ${esc(R.short)}</span><span class="tb-count">Manche ${g.roundIdx + 1}/${total}${r.total && r.n ? ' · ' + (r.type === 'mystere' || r.type === 'table' || r.type === 'quatre' ? 'Tour' : 'Q.') + ' ' + Math.min(r.n, r.total) + '/' + r.total : ''}</span>`;
      }
      patch($('#tb-center'), center);
      const link = g.code ? `<span class="tb-join">Rejoindre : <b>${esc(this.joinHost())}</b></span><span class="tb-code">${esc(g.code)}</span>` : '';
      patch($('#tb-right'), g.phase === 'lobby' ? '' : link);
    }
    joinHost() { return PQA.baseURL().replace(/^https?:\/\//, '').replace(/\/$/, '') + '/play'; }

    renderControls() {
      const g = this.g;
      const canNext = ['intro', 'reveal', 'leaderboard', 'ladder', 'cell', 'qresult', 'ko', 'wheel', 'question'].includes(g.phase);
      patch($('#controls'), `
        ${canNext ? `<button class="ctl" data-act="next" title="Espace">${g.phase === 'question' ? '⏭ Révéler' : '▶ Suivant'}</button>` : ''}
        ${g.phase !== 'lobby' && g.phase !== 'end' ? `<button class="ctl" data-act="pause" title="P">${g.paused ? '▶ Reprendre' : '⏸ Pause'}</button>` : ''}
        <button class="ctl" data-act="pref" data-key="tts" title="Voix du présentateur">${this.prefs.tts ? '🗣️ Voix' : '🤐 Voix'}</button>
        <button class="ctl" data-act="pref" data-key="muted" title="Couper tous les sons">${this.prefs.muted ? '🔇 Muet' : '🔊 Son'}</button>
        <button class="ctl" data-act="sounds" title="Musique, effets, voix">🎚️ Réglages</button>
        <button class="ctl" data-act="pref" data-key="crt">📺 CRT</button>
        <button class="ctl" data-act="fullscreen" title="F">⛶</button>`);
      $('#pause-overlay').classList.toggle('on', g.paused);
    }

    renderPodiums() {
      const g = this.g, q = g.q;
      const list = g.activePlayers();
      const html = list.map((p) => {
        let pose = 'idle', badge = '', cls = '';
        if (!p.connected && !p.local) cls += ' off';
        if (q && q.buzz && q.buzz.current === p.id) { pose = 'buzz'; cls += ' buzzing'; }
        if (q && q.buzz && q.buzz.locked.includes(p.id)) badge += '<i title="Bloqué">🔒</i>';
        if (q && q.kind === 'all' && g.phase === 'question' && q.answers[p.id]) badge += '<i class="ok">✔</i>';
        if (q && q.kind === 'ladder' && g.phase === 'question' && q.answers[p.id]) badge += '<i class="ok">✔</i>';
        if ((g.phase === 'reveal') && q && q.results[p.id] && !g.revealPending) { pose = q.results[p.id].correct ? 'happy' : q.results[p.id].none ? 'idle' : 'sad'; }
        if (g.phase === 'end' && g.ranking()[0] === p) pose = 'happy';
        const cur = g.round && (g.phase === 'level' || g.phase === 'board' || g.phase === 'target' || g.phase === 'qpick' || (g.phase === 'question' && q && (q.kind === 'single' || q.kind === 'quatre'))) && (g.round.player === p.id);
        if (cur) cls += ' turn';
        if (g.isFrozen(p)) badge += '<i>🧊</i>';
        if (p.double) badge += '<i>✖️2</i>';
        if (p.streak >= 3) badge += `<i class="fire">🔥x${g.multiplier(p)}</i>`;
        if (p.cards.length) badge += `<i>🃏${p.cards.length}</i>`;
        const team = g.settings.teams ? `<span class="pod-team" style="background:${PQA.PALETTE.team[p.team]}"></span>` : '';
        const lobbyBtns = g.phase === 'lobby' ? `<button class="pod-x" data-act="kick" data-pid="${p.id}" title="Retirer">✖</button>` : '';
        const teamAct = g.phase === 'lobby' && g.settings.teams;
        const key = p.local ? `<span class="pod-key">${p.key.toUpperCase()}</span>` : '';
        return { p, cls, teamAct, inner: `${team}${lobbyBtns}${key}
          <div class="pod-badges">${badge}</div>
          ${avatarImg(p, pose)}
          <div class="pod-name">${esc(p.name)}</div>
          <div class="pod-score" data-pid="${p.id}">${fmt(this.scoreShown[p.id] != null ? Math.round(this.scoreShown[p.id]) : p.score)}</div>` };
      });
      // Chaque pupitre est un élément durable : on ne met à jour que son contenu,
      // pour ne pas relancer son animation d'entrée à chaque changement.
      const el = $('#podiums');
      el.style.setProperty('--n', Math.max(list.length, 4));
      const keep = new Set(list.map((p) => 'pod-' + p.id));
      Array.from(el.children).forEach((c) => { if (!keep.has(c.id)) c.remove(); });
      html.forEach(({ p, cls, teamAct, inner }, i) => {
        let pod = document.getElementById('pod-' + p.id);
        if (!pod) { pod = document.createElement('div'); pod.id = 'pod-' + p.id; }
        if (el.children[i] !== pod) el.insertBefore(pod, el.children[i] || null);
        pod.className = 'pod' + cls;
        pod.style.setProperty('--pc', p.color);
        if (teamAct) { pod.dataset.act = 'team'; pod.dataset.pid = p.id; } else { delete pod.dataset.act; }
        if (pod._html !== inner) {
          // le score est animé par la boucle : on ne l'écrase pas pendant le comptage
          pod._html = inner;
          pod.innerHTML = inner;
        }
      });
      let empty = document.getElementById('pod-empty');
      if (!list.length && !empty) { empty = document.createElement('div'); empty.id = 'pod-empty'; empty.className = 'pod-empty'; empty.textContent = 'En attente des candidats...'; el.appendChild(empty); }
      if (list.length && empty) empty.remove();
    }

    /* ---- Chaque phase a son rendu : { key, html, parts, after } ---- */
    r_wait() { return { key: 'wait', html: '<div class="center-msg">...</div>' }; }

    r_lobby() {
      const g = this.g, s = g.settings;
      const url = PQA.baseURL() + 'play.html?room=' + g.code + PQA.config.passthroughQuery();
      const purl = PQA.baseURL() + 'presenter.html?room=' + g.code + PQA.config.passthroughQuery();
      const seg = (key, opts, cur) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-key="${key}" data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      const duel = s.mode === 'duel';
      const settings = `
        <div class="set-row"><label>Mode</label>${seg('mode', [['virtual', '🤖 Présentateur virtuel'], ['irl', '🎤 Présentateur IRL'], ['duel', '🥊 Duel 1 contre 1']], s.mode)}</div>
        ${duel ? `<div class="set-row"><label>Duel</label><div class="seg"><button data-act="localduel" class="${s.localDuel ? 'on' : ''}">⌨️ Les 2 sur cet écran (touches A / L)</button></div></div>` : `
        <div class="set-row"><label>Équipes</label>${seg('teams', [[0, 'Chacun pour soi'], [2, '2'], [3, '3'], [4, '4']], s.teams)}${s.teams ? '<button class="mini" data-act="shuffleteams">🔀 Mélanger</button>' : ''}</div>
        <div class="set-row"><label>Manches</label><div class="chips">${PQA.ROUND_ORDER.map((r) => `<button data-act="round" data-val="${r}" class="${s.rounds.includes(r) ? 'on' : ''}">${PQA.ROUNDS[r].icon} ${esc(PQA.ROUNDS[r].short)}</button>`).join('')}</div></div>
        <div class="set-row"><label>Durée</label>${seg('length', [['court', 'Courte'], ['normal', 'Normale'], ['long', 'Longue']], s.length)}</div>
        <div class="set-row"><label>Finale</label>${seg('finale', [['solo', 'Le leader seul'], ['duo', 'Face-à-face des 2 premiers']], s.finale)}</div>
        <div class="set-row"><label>Coups bas</label>${seg('cards', [['1', '🃏 Oui'], ['0', 'Non']], s.cards ? '1' : '0')}</div>`}
        <div class="set-row small"><label>Questions</label><span>${g.bank.length} au total · ${g.seen.size} déjà vues sur cet écran</span><button class="mini" data-act="resetseen">Oublier</button></div>`;
      const n = g.activePlayers().length;
      const canStart = duel ? n === 2 : n >= 1;
      const info = `<button class="big-btn ${canStart ? '' : 'disabled'}" data-act="start">▶ LANCER L’ÉMISSION</button>
        <div><div class="lobby-count">${n} joueur${n > 1 ? 's' : ''} ${duel ? '/ 2' : '/ 10'}</div><div class="netdiag">Réseau : ${esc(PQA.netDiagText())}</div></div>`;
      const pres = s.mode === 'irl' ? `<div class="pres-join"><img class="qr small" src="${this.qr(purl)}" alt=""><div><b>Télécommande du présentateur</b><br>${g.presenter.connected ? '<span class="okc">✔ Connectée</span>' : 'Scanne ce code avec le téléphone du présentateur'}</div></div>` : '';
      return {
        key: 'lobby',
        html: `<div class="lobby">
          <div class="panel join">
            <div class="join-title">Rejoins la partie !</div>
            <img class="qr" src="${this.qr(url)}" alt="QR code">
            <div class="join-code-lbl">Code de la salle</div>
            <div class="join-code">${esc(g.code)}</div>
            <div class="join-url">${esc(this.joinHost())}</div>
            <div id="lobby-pres"></div>
          </div>
          <div class="panel settings"><div id="lobby-settings"></div><div id="lobby-info"></div></div>
        </div>`,
        parts: { 'lobby-settings': settings, 'lobby-info': info, 'lobby-pres': pres },
      };
    }
    qr(text) {
      this._qr = this._qr || {};
      if (!this._qr[text]) {
        const q = qrcode(0, 'M');
        q.addData(text);
        q.make();
        this._qr[text] = q.createDataURL(8, 2);
      }
      return this._qr[text];
    }

    r_intro() {
      const g = this.g, r = g.round, R = PQA.ROUNDS[r.type];
      return {
        key: 'intro' + g.roundIdx,
        html: `<div class="intro">
          <div class="intro-num">${r.type === 'duel' ? 'READY ?' : 'MANCHE ' + (g.roundIdx + 1) + ' / ' + g.rounds.length}</div>
          <div class="intro-icon">${R.icon}</div>
          <div class="intro-name">${esc(R.name)}</div>
          <div class="intro-desc">${esc(R.desc)}</div>
        </div>`,
      };
    }

    /* ---- Question (commune à plusieurs manches) ---- */
    qHeader(q) {
      const d = q.data;
      return `<div class="q-head"><span class="cat">${this.g.catIcon(d.categorie)} ${esc(d.categorie)}${d.sous_theme ? ' · ' + esc(d.sous_theme) : ''}</span>${diffBar(d.difficulte)}</div>`;
    }
    choicesHTML(q, revealed, hidden = []) {
      if (!q.choices) return '';
      const n = q.choices.length;
      const total = q.dist ? q.dist.reduce((a, b) => a + b, 0) : 0;
      return `<div class="choices n${n}">${q.choices.map((c, i) => {
        const isOk = i === q.correctIdx;
        const pct = revealed && q.dist && total ? Math.round((q.dist[i] / total) * 100) : null;
        const who = revealed ? Object.keys(q.answers).filter((pid) => q.answers[pid].value === i).map((pid) => this.g.players[pid]).filter(Boolean) : [];
        return `<div class="choice c${i} ${revealed ? (isOk ? 'good' : 'bad') : ''} ${hidden.includes(i) ? 'hidden' : ''}" data-act="choice" data-i="${i}">
          <span class="letter">${n === 2 ? (i === 0 ? '✔' : '✖') : LETTERS[i]}</span><span class="ctext">${esc(c)}</span>
          ${pct != null ? `<span class="pctbar" style="width:${pct}%"></span><span class="pcttxt">${pct}%</span>` : ''}
          ${who.length ? `<span class="who">${who.map((p) => avatarImg(p, isOk ? 'happy' : 'sad', 'tiny')).join('')}</span>` : ''}
        </div>`;
      }).join('')}</div>`;
    }
    anecdoteHTML(q) {
      return q.data.anecdote ? `<div class="anecdote"><b>💡 Le saviez-vous ?</b> ${esc(q.data.anecdote)}</div>` : '';
    }
    resultsHTML(q) {
      const g = this.g;
      const items = Object.keys(q.results).map((pid) => ({ p: g.players[pid], r: q.results[pid], a: q.answers[pid] })).filter((x) => x.p);
      if (!items.length) return '';
      const libre = q.data.type === 'libre' || q.data.type === 'indices';
      return `<div class="results">${items.map(({ p, r, a }) => {
        const txt = libre && a && a.text ? `« ${esc(a.text)} »` : libre && r.wrongAnswer ? `« ${esc(r.wrongAnswer)} »` : '';
        const ov = libre && q.kind === 'single' && a && !g.irl ? ` data-act="override" data-pid="${p.id}" title="Cliquer pour corriger la validation"` : '';
        return `<div class="res ${r.correct ? 'good' : 'bad'}" style="--pc:${p.color}"${ov}>${avatarImg(p, r.correct ? 'happy' : 'sad', 'tiny')}<b>${esc(p.name)}</b> ${txt}
          <span class="rpts">${r.correct ? '+' + r.pts + (r.mult > 1 ? ` <small>x${r.mult}</small>` : '') : r.none ? '—' : '✖'}</span></div>`;
      }).join('')}</div>`;
    }

    r_question() {
      const g = this.g, q = g.q, r = g.round;
      if (!q) return this.r_wait();
      if (q.kind === 'buzz') return r.type === 'duel' ? this.duelQ(false) : this.indicesQ(false);
      if (q.kind === 'ladder') return this.ladderView(false);
      if (q.kind === 'quatre') return this.quatreQ();
      const d = q.data;
      const single = q.kind === 'single' ? g.players[q.answerers[0]] : null;
      let body;
      if (d.type === 'fourchette') {
        body = `<div class="q-fourchette">🎯 Visez pile${d.unite && d.unite !== 'année' ? ' (en <b>' + esc(d.unite) + '</b>)' : ''} sur vos téléphones !</div>`;
      } else if (d.type === 'libre') {
        body = `<div class="q-libre">✍️ Réponse libre${g.irl ? ' : réponds à voix haute !' : ' : tape ta réponse sur ton téléphone'}</div>`;
      } else body = this.choicesHTML(q, false);
      const extra = r.type === 'mystere' ? `<div class="banner-pts">Niveau ${r.level} · ${r.level * 20} pts</div>` : r.type === 'table' ? `<div class="banner-pts">${r.cell.special === 'double' ? '✖️2 ' : r.cell.special === 'vol' ? '🦹 Vol sur ' + esc(g.name(r.victim)) + ' · ' : ''}${g.round.cellValue} pts</div>` : '';
      return {
        key: 'q' + q.id,
        html: `<div class="question ${d.type}">
          ${this.qHeader(q)}
          ${single ? `<div class="turn-banner" style="--pc:${single.color}">${avatarImg(single, 'idle', 'tiny')} À ${esc(single.name)} de répondre !</div>` : ''}
          ${extra}
          <div class="q-text">${esc(d.question)}</div>
          ${body}
          <div id="q-status"></div>
        </div>`,
        parts: { 'q-status': this.answeredStatus(q) },
      };
    }
    answeredStatus(q) {
      const g = this.g;
      if (q.kind !== 'all') {
        if (q.pending) return `<div class="status">🎤 ${esc(g.name(q.pending.pid))} a répondu, le présentateur valide...</div>`;
        return '';
      }
      const n = Object.keys(q.answers).length;
      return `<div class="status">${n} / ${q.answerers.length} réponse${n > 1 ? 's' : ''} ${'▮'.repeat(n)}</div>`;
    }

    r_reveal() {
      const g = this.g, q = g.q, r = g.round;
      if (!q) return this.r_wait();
      if (r.type === 'duel') return this.duelQ(true);
      if (q.kind === 'ladder') return this.ladderView(true);
      if (q.kind === 'buzz') return this.indicesQ(true);
      const d = q.data;
      if (d.type === 'fourchette') return this.fourchetteReveal();
      const answerBox = d.type === 'libre' ? `<div class="answer-big">✔ ${esc(d.reponse)}</div>` : '';
      return {
        key: 'r' + q.id,
        html: `<div class="question revealed ${d.type}">
          ${this.qHeader(q)}
          <div class="q-text small">${esc(d.question)}</div>
          ${answerBox}
          ${this.choicesHTML(q, true)}
          <div id="q-results"></div>
          ${g.irl ? this.anecdoteHTML(q) : ''}
        </div>`,
        parts: { 'q-results': this.resultsHTML(q) },
      };
    }

    /* ---- Fourchette : la règle graduée ---- */
    fourchetteReveal() {
      const g = this.g, q = g.q, d = q.data;
      const entries = Object.keys(q.answers).map((pid) => ({ p: g.players[pid], a: q.answers[pid].value, r: q.results[pid] })).filter((x) => x.p);
      let lo = d.reponse, hi = d.reponse;
      entries.forEach((e) => { lo = Math.min(lo, e.a); hi = Math.max(hi, e.a); });
      if (hi === lo) { hi += Math.max(1, Math.abs(hi) * 0.1); lo -= Math.max(1, Math.abs(lo) * 0.1); }
      const pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;
      const X = (v) => ((v - lo) / (hi - lo)) * 100;
      const stp = PQA.niceStep((hi - lo) / 5);
      const ticks = [];
      for (let t = Math.ceil(lo / stp) * stp; t <= hi; t += stp) ticks.push(t);
      const V = (v) => PQA.fmtVal(v, d.unite, false);
      const unit = d.unite && d.unite !== 'année' ? ' ' + esc(d.unite) : '';
      const gap = (e) => Math.abs(e.a - d.reponse);
      const rows = entries.sort((a, b) => gap(a) - gap(b)).map((e, i) => {
        const ok = e.r && e.r.correct;
        return `<div class="fr-row" style="--d:${i * 0.25}s">
          <div class="fr-name"><b style="color:${e.p.color}">${esc(e.p.name)}</b><small>${V(e.a)}</small></div>
          <div class="fr-track"><div class="fr-dot ${ok ? 'good' : 'bad'}" style="left:${X(e.a)}%;--pc:${e.p.color}"></div></div>
          <div class="fr-pts ${ok ? 'good' : ''}">${ok ? '+' + e.r.pts + (e.r.exact ? ' 🎯' : e.r.rank === 1 ? ' ★' : '') : '✖'}</div>
        </div>`;
      }).join('');
      return {
        key: 'r' + q.id,
        html: `<div class="fourchette-reveal">
          ${this.qHeader(q)}
          <div class="q-text small">${esc(d.question)}</div>
          <div class="ruler">
            <div class="fr-rows">${rows || '<div class="center-msg small">Personne n’a répondu !</div>'}
              <div class="fr-answer" style="left:calc(260px + (100% - 380px) * ${X(d.reponse) / 100})"><span>${V(d.reponse)}${unit}</span></div>
            </div>
            <div class="fr-axis">${ticks.map((t) => `<span style="left:${X(t)}%">${V(Math.round(t * 1000) / 1000 || 0)}</span>`).join('')}</div>
          </div>
          <div class="answer-big late">✔ ${V(d.reponse)}${unit}</div>
          ${g.irl ? this.anecdoteHTML(q) : ''}
        </div>`,
      };
    }

    /* ---- Buzzer à indices ---- */
    indicesQ(revealed) {
      const g = this.g, q = g.q, d = q.data, b = q.buzz;
      const n = d.indices.length;
      const shown = revealed ? n : q.clue + 1;
      const pts = Math.round((300 * (n - q.clue)) / n / 10) * 10;
      const clues = d.indices.map((c, i) => `<li class="${i < shown ? 'on' : ''} ${i === q.clue && !revealed ? 'cur' : ''}"><span class="cn">${i + 1}</span>${i < shown ? esc(c) : '? ? ?'}</li>`).join('');
      const cur = b.current && g.players[b.current];
      const banner = revealed ? '' : cur ? `<div class="buzz-banner" style="--pc:${cur.color}">${avatarImg(cur, 'buzz', 'tiny')} ${esc(cur.name)} a buzzé !${q.pending ? ' <small>(validation...)</small>' : ''}</div>`
        : b.readyAt && performance.now() < b.readyAt ? `<div class="buzz-open wait">⏳ Lisez bien… buzz trop tôt = bloqué 2 s</div>`
        : `<div class="buzz-open">🔔 Buzzers ouverts · ${pts} pts · raté = −100</div>`;
      const winner = revealed && Object.keys(q.results).find((pid) => q.results[pid].correct);
      return {
        key: (revealed ? 'r' : 'q') + q.id,
        html: `<div class="indices">
          ${this.qHeader(q)}
          <div class="q-text">${esc(d.question)}</div>
          <ol class="clues" id="clues"></ol>
          <div id="buzz-state"></div>
          ${revealed ? `<div class="answer-big">✔ ${esc(d.reponse)}</div><div id="q-results"></div>${g.irl ? this.anecdoteHTML(q) : ''}` : ''}
        </div>`,
        parts: { clues, 'buzz-state': banner, ...(revealed ? { 'q-results': winner || Object.keys(q.results).length ? this.resultsHTML(q) : '<div class="status">Personne n’a trouvé !</div>' } : {}) },
      };
    }

    /* ---- Duel ---- */
    duelQ(revealed) {
      const g = this.g, q = g.q, r = g.round;
      const [a, b] = r.fighters.map((id) => g.players[id]);
      const cur = q.buzz.current && g.players[q.buzz.current];
      const bar = (p, side) => `<div class="fighter ${side}" style="--pc:${p.color}">
          ${avatarImg(p, q.buzz.current === p.id ? 'buzz' : revealed && q.results[p.id] ? (q.results[p.id].correct ? 'happy' : 'sad') : 'idle', 'fav')}
          <div class="fname">${esc(p.name)}${p.local ? ` <small>[${p.key.toUpperCase()}]</small>` : ''}</div>
          <div class="hp"><div class="hp-fill" style="width:${r.hp[p.id]}%"></div><span>${r.hp[p.id]} PV</span></div>
        </div>`;
      const banner = revealed ? '' : cur ? `<div class="buzz-banner" style="--pc:${cur.color}">${esc(cur.name)} répond !${cur.local ? ` <small>(${cur.key === 'a' ? 'touches 1-4' : 'touches 7-0'})</small>` : ''}</div>`
        : q.buzz.readyAt && performance.now() < q.buzz.readyAt ? `<div class="buzz-open wait">⏳ Lisez bien… buzz trop tôt = bloqué 2 s</div>`
        : `<div class="buzz-open">🔔 Buzzez ! ${g.settings.localDuel ? '<small>(touches A et L)</small>' : ''}</div>`;
      const hit = r.lastHit && revealed && q.results[r.lastHit.from] ? `<div class="dmg-pop">-${r.lastHit.dmg}${r.lastHit.crit ? ' CRITIQUE !' : ''}</div>` : '';
      return {
        key: (revealed ? 'r' : 'q') + q.id,
        html: `<div class="duel">
          <div class="duel-top" id="duel-top"></div>
          <div class="duel-round">ROUND ${r.n}</div>
          ${this.qHeader(q)}
          <div class="q-text">${esc(q.data.question)}</div>
          ${this.choicesHTML(q, revealed)}
          <div id="buzz-state"></div>${hit}
          ${revealed ? (g.irl ? this.anecdoteHTML(q) : '') : ''}
        </div>`,
        parts: { 'duel-top': bar(a, 'left') + '<div class="vs">VS</div>' + bar(b, 'right'), 'buzz-state': banner },
      };
    }
    r_ko() {
      const g = this.g, r = g.round, w = g.players[r.winner];
      return { key: 'ko', html: `<div class="ko"><div class="ko-text">K.O. !</div>${w ? avatarImg(w, 'happy', 'huge') + `<div class="ko-win" style="color:${w.color}">${esc(w.name)} gagne le duel !</div>` : ''}</div>` };
    }

    /* ---- Thème Mystère : la roue ---- */
    r_wheel() {
      const g = this.g, r = g.round, w = r.wheel;
      const n = w.slots.length, seg = 360 / n;
      const colors = ['#b13e53', '#3b5dc9', '#38b764', '#ef7d57', '#5d275d', '#257179', '#ffcd75', '#41a6f6'];
      const grad = w.slots.map((_, i) => `${colors[i % 8]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',');
      const labels = w.slots.map((s, i) => `<div class="wl" style="transform:rotate(${i * seg + seg / 2}deg)"><span>${s.icon}<br>${esc(s.name)}</span></div>`).join('');
      const final = 360 * 6 + (360 - (w.target * seg + seg / 2));
      const p = g.players[r.player];
      return {
        key: 'wheel' + r.n,
        html: `<div class="wheel-wrap">
          <div class="wheel-player">${p ? avatarImg(p, 'idle', 'tiny') + ' Tour de <b style="color:' + p.color + '">' + esc(p.name) + '</b>' : ''}</div>
          <div class="wheel-box"><div class="pointer">▼</div><div class="wheel" id="wheel" style="background:conic-gradient(${grad})">${labels}</div><div class="hub">?</div></div>
        </div>`,
        after: () => {
          const el = document.getElementById('wheel');
          if (!el) return;
          el.style.transition = `transform ${w.spin}ms cubic-bezier(.15,.75,.2,1)`;
          el.style.transform = `rotate(${final}deg)`;
          // Cliquetis de la roue qui ralentit
          let t = 0, step = 50;
          while (t < w.spin - 300) { setTimeout(() => sfx.wheelTick(), t); t += step; step *= 1.06; }
          setTimeout(() => { sfx.coin(); this.audience.cheer(0.6); }, w.spin);
        },
      };
    }
    r_level() {
      const g = this.g, r = g.round, p = g.players[r.player];
      return {
        key: 'level' + r.n,
        html: `<div class="level-wrap">
          <div class="level-cat">${g.catIcon(r.cat)} ${esc(r.cat)}</div>
          <div class="level-who">${p ? avatarImg(p, 'idle') : ''}<div><b style="color:${p && p.color}">${esc(p && p.name)}</b> choisit son niveau...</div></div>
          <div class="level-scale" id="level-scale"></div>
        </div>`,
        parts: { 'level-scale': Array.from({ length: 10 }, (_, i) => `<span class="${r.level === i + 1 ? 'on' : ''}">${i + 1}<small>${(i + 1) * 20}</small></span>`).join('') },
      };
    }

    /* ---- Table des Savoirs ---- */
    boardHTML() {
      const r = this.g.round;
      const head = Array.from({ length: r.cols }, (_, x) => { const c = r.cells.find((c) => c.x === x); return `<div class="bh">${c.icon}<br>${esc(c.cat)}</div>`; }).join('');
      const cells = r.cells.map((c) => {
        const cur = r.cell && r.cell.i === c.i;
        return `<div class="bc ${c.used ? 'used' : ''} ${cur ? 'cur' : ''}">${c.used ? (cur ? '' : '✓') : '?'}</div>`;
      }).join('');
      return `<div class="board" style="--cols:${r.cols}">${head}${cells}</div>`;
    }
    r_board() {
      const g = this.g, r = g.round, p = g.players[r.player];
      return {
        key: 'board',
        html: `<div class="table-wrap"><div id="board"></div><div class="board-turn" id="board-turn"></div></div>`,
        parts: { board: this.boardHTML(), 'board-turn': p ? `${avatarImg(p, 'idle', 'tiny')} <b style="color:${p.color}">${esc(p.name)}</b> choisit une case sur son téléphone` : '' },
      };
    }
    r_cell() {
      const g = this.g, r = g.round, c = r.cell, p = g.players[r.player];
      const special = c.special === 'piege' ? `<div class="cell-sp trap">💣 PIÈGE !</div><div class="cell-val">-${r.trapLoss} pts pour ${esc(p.name)}</div>`
        : c.special === 'double' ? `<div class="cell-sp dbl">✖️2 CASE DOUBLE !</div><div class="cell-val">${r.cellValue} pts</div>`
        : c.special === 'vol' ? `<div class="cell-sp vol">🦹 VOL DE POINTS !</div><div class="cell-val">${c.value} pts à voler</div>`
        : `<div class="cell-val">${c.value} pts</div>`;
      return {
        key: 'cell' + c.i,
        html: `<div class="table-wrap"><div id="board"></div><div class="cell-card ${c.special || ''}"><div class="cell-cat">${c.icon} ${esc(c.cat)}</div>${special}</div></div>`,
        parts: { board: this.boardHTML() },
      };
    }
    r_target() {
      const g = this.g, p = g.players[g.round.player];
      return { key: 'target', html: `<div class="table-wrap"><div id="board"></div><div class="cell-card vol"><div class="cell-sp vol">🦹</div><div class="cell-val">${esc(p.name)} choisit sa victime...</div></div></div>`, parts: { board: this.boardHTML() } };
    }

    /* ---- 4 à la suite ---- */
    r_qpick() {
      const g = this.g, r = g.round, p = g.players[r.player];
      return {
        key: 'qpick' + r.n,
        html: `<div class="quatre-pick"><div class="turn-banner" style="--pc:${p.color}">${avatarImg(p, 'idle', 'tiny')} ${esc(p.name)} choisit son thème</div>
          <div class="themes">${r.themes.map((t) => `<div class="theme">${t.icon}<span>${esc(t.name)}</span></div>`).join('')}</div>
          <div class="status">40 secondes pour enchaîner 4 bonnes réponses d’affilée !</div></div>`,
      };
    }
    quatreQ() {
      const g = this.g, q = g.q, r = g.round, p = g.players[r.player];
      const meter = Array.from({ length: 4 }, (_, i) => `<span class="${i < r.run.streak ? 'on' : ''}">${i + 1}</span>`).join('');
      return {
        key: 'quatre' + q.id,
        html: `<div class="quatre">
          <div class="turn-banner" style="--pc:${p.color}">${avatarImg(p, 'idle', 'tiny')} ${esc(p.name)} · ${esc(r.cat)}</div>
          <div class="q4-meter" id="q4-meter"></div>
          <div class="q-text">${esc(q.data.question)}</div>
          ${this.choicesHTML(q, false)}
          <div id="q4-last"></div>
        </div>`,
        parts: { 'q4-meter': meter, 'q4-last': r.run.last ? `<div class="q4-last ${r.run.last.ok ? 'good' : 'bad'}">${r.run.last.ok ? '✔ Bonne réponse !' : '✖ Raté : c’était « ' + esc(r.run.last.answer) + ' »'}</div>` : '' },
      };
    }
    r_qresult() {
      const g = this.g, r = g.round, p = g.players[r.player], run = r.run;
      return {
        key: 'qres' + r.n,
        html: `<div class="center-card">${avatarImg(p, run.won ? 'happy' : 'idle', 'huge')}
          <div class="cc-title">${run.won ? '🏆 4 À LA SUITE !' : '⏱ Temps écoulé'}</div>
          <div class="cc-sub">${esc(p.name)} : ${run.correct} bonne${run.correct > 1 ? 's' : ''} réponse${run.correct > 1 ? 's' : ''}, meilleure série ${run.best}/4${run.won ? ' · bonus +' + run.bonus : ''}</div></div>`,
      };
    }

    /* ---- Finale : l'Échelle ---- */
    ladderHTML() {
      const g = this.g, r = g.round;
      return `<div class="ladder">${PQA.LADDER.map((v, i) => {
        const here = r.climbers.filter((c) => c.step === i + 1).map((c) => g.players[c.id]).filter(Boolean);
        return `<div class="rung ${i === PQA.LADDER_SAFE ? 'safe' : ''} ${i === 9 ? 'top' : ''}"><span class="rn">${i + 1}</span><span class="rv">${fmt(v)}</span>${here.map((p) => avatarImg(p, 'happy', 'tiny')).join('')}</div>`;
      }).reverse().join('')}<div class="rung ground">${r.climbers.filter((c) => c.step === 0).map((c) => avatarImg(g.players[c.id], 'idle', 'tiny')).join('')} Départ</div></div>`;
    }
    climbersHTML() {
      const g = this.g, r = g.round;
      return r.climbers.map((c) => {
        const p = g.players[c.id];
        const st = c.status === 'out' ? '❌ Éliminé' : c.status === 'stopped' ? '✋ Arrêté' : c.status === 'top' ? '🏆 Sommet' : c.answer != null ? '🔒 Réponse verrouillée' : '🤔 Réfléchit...';
        const j = (k, icon, label) => `<span class="jk ${c.jokers[k] ? '' : 'used'}" title="${label}">${icon}</span>`;
        return `<div class="climber" style="--pc:${p.color}">${avatarImg(p, 'idle', 'tiny')}<b>${esc(p.name)}</b> <span class="cst">${st}</span>
          <span class="jokers">${j('fifty', '½', '50/50')}${j('public', '👥', 'Avis du public')}${j('friend', '📞', 'Appel à un ami')}</span>
          <span class="bank">${c.banked ? '+' + c.banked : c.step ? fmt(PQA.LADDER[c.step - 1]) : ''}</span></div>`;
      }).join('');
    }
    ladderView(revealed) {
      const g = this.g, r = g.round, q = g.q;
      const solo = r.climbers.length === 1;
      const hidden = solo && r.climbers[0].hidden ? r.climbers[0].hidden : [];
      let extra = '';
      if (r.vote) {
        if (r.vote.open) extra = `<div class="joker-panel">👥 Le public vote... (${Object.keys(r.vote.votes).length}/${r.vote.voters.length})</div>`;
        else { const tot = r.vote.dist.reduce((a, b) => a + b, 0) || 1; extra = `<div class="joker-panel"><b>👥 Avis du public</b><div class="vote-bars">${r.vote.dist.map((n, i) => `<div class="vb"><div class="vbf" style="height:${(n / tot) * 100}%"></div><span>${LETTERS[i]} ${Math.round((n / tot) * 100)}%</span></div>`).join('')}</div></div>`; }
      }
      if (r.friend && !r.friend.done) extra += `<div class="joker-panel">📞 Appel à <b>${esc(g.name(r.friend.id))}</b> : il a la question sur son téléphone, écoutez-le !</div>`;
      const suspense = revealed && g.revealPending;
      const step = Math.max(0, ...r.climbers.filter((c) => q.answerers.includes(c.id)).map((c) => c.step - (revealed && !suspense && q.results[c.id] && q.results[c.id].correct ? 1 : 0)));
      return {
        key: (revealed ? 'r' : 'q') + q.id + (suspense ? 's' : ''),
        html: `<div class="ladder-wrap">
          <div id="ladder"></div>
          <div class="ladder-q">
            <div class="q-head"><span class="cat">🪜 Marche ${step + 1} · ${fmt(PQA.LADDER[Math.min(9, step)])} pts</span>${diffBar(q.data.difficulte)}</div>
            <div class="q-text">${esc(q.data.question)}</div>
            <div id="ladder-choices"></div>
            <div id="ladder-extra"></div>
            <div id="climbers"></div>
            ${revealed && !suspense && g.irl ? this.anecdoteHTML(q) : ''}
          </div>
        </div>`,
        parts: { ladder: this.ladderHTML(), 'ladder-choices': this.choicesHTML(q, revealed && !suspense, hidden), 'ladder-extra': extra, climbers: this.climbersHTML() },
      };
    }
    r_ladder() {
      const g = this.g, r = g.round;
      return {
        key: 'ladder-intro',
        html: `<div class="ladder-wrap"><div id="ladder"></div><div class="ladder-q"><div class="intro-name">🪜 La grande finale</div>
          <div class="intro-desc">${r.climbers.map((c) => esc(g.name(c.id))).join(' et ')} ${r.climbers.length > 1 ? 'vont' : 'va'} tenter de gravir les 10 marches. Palier assuré à la marche ${PQA.LADDER_SAFE + 1}. Jokers : ½ 50/50 · 👥 avis du public · 📞 appel à un ami.</div>
          <div id="climbers"></div></div></div>`,
        parts: { ladder: this.ladderHTML(), climbers: this.climbersHTML() },
      };
    }
    r_ladderEnd() {
      const g = this.g, r = g.round;
      return { key: 'ladder-end', html: `<div class="ladder-wrap"><div id="ladder"></div><div class="ladder-q"><div class="intro-name">Fin de l’ascension !</div><div id="climbers"></div></div></div>`, parts: { ladder: this.ladderHTML(), climbers: this.climbersHTML() } };
    }

    /* ---- Classement entre les manches ---- */
    r_leaderboard() {
      const g = this.g;
      const rk = g.ranking();
      const max = Math.max(1, ...rk.map((p) => p.score));
      const teams = g.settings.teams ? `<div class="team-scores">${g.teamScores().map((t, i) => `<div class="tscore" style="--pc:${t.color}"><b>${i + 1}. ${esc(t.name)}</b><span>${fmt(t.score)}</span></div>`).join('')}</div>` : '';
      const rows = rk.map((p, i) => {
        const move = (p.prevRank || i + 1) - (i + 1);
        return `<div class="lb-row" style="--from:${((p.prevRank || i + 1) - (i + 1)) * 62}px;--d:${i * 0.08}s;--pc:${p.color}">
          <span class="lb-rank">${i + 1}</span>${avatarImg(p, i === 0 ? 'happy' : 'idle', 'tiny')}
          <span class="lb-name">${esc(p.name)}</span>
          <span class="lb-bar"><span style="width:${(Math.max(0, p.score) / max) * 100}%"></span></span>
          <span class="lb-score">${fmt(p.score)}</span>
          <span class="lb-move ${move > 0 ? 'up' : move < 0 ? 'down' : ''}">${move > 0 ? '▲' + move : move < 0 ? '▼' + -move : '='}</span>
        </div>`;
      }).join('');
      return { key: 'lb' + g.roundIdx, html: `<div class="leaderboard"><div class="lb-title">🏆 Classement</div>${teams}<div class="lb-rows">${rows}</div></div>` };
    }

    /* ---- Fin de partie ---- */
    r_end() {
      const g = this.g;
      const rk = g.ranking();
      const podium = [rk[1], rk[0], rk[2]].map((p, i) => p ? `<div class="podium-step s${[2, 1, 3][i]}" style="--pc:${p.color}">${avatarImg(p, i === 1 ? 'happy' : 'idle', 'big')}<div class="ps-name">${esc(p.name)}</div><div class="ps-block"><span>${[2, 1, 3][i]}</span><small>${fmt(p.score)}</small></div></div>` : '<div class="podium-step empty"></div>').join('');
      const titles = rk.map((p) => { const t = g.titles && g.titles[p.id]; return t ? `<div class="title-row" style="--pc:${p.color}"><b>${esc(p.name)}</b> <span class="tt">« ${esc(t.title)} »</span> <small>${esc(t.desc)}</small></div>` : ''; }).join('');
      const team = g.settings.teams ? (() => { const t = g.teamScores()[0]; return `<div class="team-win" style="--pc:${t.color}">Victoire de l’équipe des ${esc(t.name)} ! (${fmt(t.score)} pts)</div>`; })() : '';
      return {
        key: 'end',
        html: `<div class="end">
          <div class="end-title">🏆 FIN DE L’ÉMISSION 🏆</div>${team}
          <div class="end-grid"><div class="podium">${podium}</div><div class="titles">${titles}</div></div>
          <div class="end-btns"><button class="big-btn" data-act="lobby">🔁 Nouvelle partie</button></div>
        </div>`,
      };
    }

    /* ======================= Présentateur virtuel ================== */
    say(text, expr) {
      this.expr = expr || 'neutral';
      this.typing = { text, i: 0, last: 0 };
      // Deux répliques d'affilée (« C'est parti ! » puis l'annonce de la manche) : on dit les deux.
      const t = performance.now(), same = t - (this.lastSay || 0) < 50;
      this.lastSay = t;
      if (this.g.settings.mode !== 'irl') voice.speak(text, { queue: same });
    }
    /** Lit la question (ou le nouvel indice) juste après la réplique du présentateur. */
    readAloud(fn) {
      if (this.g.settings.mode === 'irl') return;
      // La réplique (« Question suivante ! ») est dite juste après l'effet : on passe derrière.
      Promise.resolve().then(() => { const t = fn(); if (t) voice.speak(t, { queue: true, kind: 'question' }); });
    }

    /** Choisit la musique selon la phase de jeu (appelé à chaque image). */
    updateMusic() {
      const g = this.g;
      let want = null, delay = 0;
      if (g.paused) want = null;
      else if (g.phase === 'lobby') want = 'theme';
      else if (g.phase === 'end') { want = 'finale'; delay = 1.5; }
      else if (g.phase === 'leaderboard') want = 'leaderboard';
      else if (g.phase === 'question') want = 'suspense';
      else if (g.round) { want = PQA.MUSIC_TRACKS['round_' + g.round.type] ? 'round_' + g.round.type : 'theme'; delay = 0.8; }
      // Le suspense accélère quand le chrono s'épuise (jusqu'à presque 2x).
      music.tempo = g.timer && g.timer.total ? 1 + (1 - g.timerLeft() / g.timer.total) * 0.85 : 1;
      if (want !== this.musicWant) { this.musicWant = want; music.play(want, delay); }
    }

    /* ======================= Effets ================================ */
    fx(name, d) {
      const g = this.g;
      const p = d.pid && g.players[d.pid];
      switch (name) {
        case 'join': sfx.join(); this.audience.cheer(0.5); break;
        case 'rejoin': sfx.select(); break;
        case 'start': music.sting('opening'); sfx.applause(3); this.audience.cheer(1); this.confetti(80); break;
        case 'roundIntro': music.sting('round'); sfx.whoosh(); this.audience.cheer(0.7); break;
        case 'question': {
          sfx.whoosh(); voice.stop();
          const q = g.q;
          this.readAloud(() => q && g.q === q && q.data && [q.data.question, q.data.indices && q.data.indices[0]].filter(Boolean).join(' '));
          break;
        }
        case 'lock': sfx.lock(); break;
        case 'select': sfx.select(); break;
        case 'clue': {
          sfx.pop();
          const q = g.q;
          this.readAloud(() => q && g.q === q && !q.buzz.current && q.data.indices && q.data.indices[q.clue]);
          break;
        }
        case 'falsestart': sfx.falseStart(); if (p) this.flash('#e43b44'); break;
        case 'buzz': sfx.buzz(p ? p.colorIdx : 0); this.shake(1); this.flash(p ? p.color : '#fff'); break;
        case 'wrong': sfx.wrong(); sfx.ooh(0.6); this.shake(1); break;
        case 'correct': sfx.coin(); break;
        case 'reveal':
          if (d.winners && d.winners.length) { sfx.correct(); sfx.applause(2, 0.5 + Math.min(0.6, d.winners.length * 0.15)); this.audience.cheer(0.9); this.confetti(25 + d.winners.length * 10); }
          else { sfx.wrong(); sfx.ooh(); }
          break;
        case 'points': if (p && d.pts) this.popAt(p.id, (d.pts > 0 ? '+' : '') + d.pts, d.pts > 0 ? '#a7f070' : '#e43b44'); break;
        case 'pop': if (p && d.text) this.popAt(p.id, d.text, '#ffcd75'); break;
        case 'streak': sfx.fire(); sfx.wow(); this.bigText(d.mult >= 4 ? '4 À LA SUITE !' : `ON FIRE x${d.mult} 🔥`, p ? p.color : '#ef7d57'); this.shake(2); this.audience.cheer(1); break;
        case 'card': { sfx.card(); const t = g.players[d.target]; this.bigText(`${PQA.CARDS[d.card].icon} ${p ? p.name : ''} ${t ? '→ ' + t.name : ''}`, '#b55088', PQA.CARDS[d.card].name.toUpperCase()); if (d.card === 'gel') sfx.freeze(); break; }
        case 'cardGain': sfx.coin(); if (p) this.popAt(p.id, '🃏 Carte !', '#73eff7'); break;
        case 'trap': sfx.explosion(); sfx.ooh(0.8); this.shake(3); this.flash('#e43b44'); break;
        case 'double': sfx.coin(); sfx.wow(0.8); this.audience.cheer(1); break;
        case 'steal': sfx.card(); break;
        case 'drumroll': sfx.drumroll(2); break;
        case 'wheel': break;
        case 'leaderboard': music.sting('round'); this.audience.cheer(0.6); break;
        case 'ladder': music.sting('round'); this.audience.cheer(1); break;
        case 'joker': sfx.card(); break;
        case 'hit': sfx.hit(); this.shake(d.crit ? 3 : 2); this.flash('#e43b44'); break;
        case 'ko': sfx.ko(); this.shake(3); setTimeout(() => { sfx.victory(); this.confetti(150); }, 1200); break;
        case 'end': sfx.drumroll(1.2); setTimeout(() => { sfx.victory(); this.confetti(200); this.audience.cheer(1); }, 1300); break;
      }
    }
    shake(level) {
      const el = $('#shaker');
      el.classList.remove('shake1', 'shake2', 'shake3');
      void el.offsetWidth;
      el.classList.add('shake' + level);
    }
    flash(color) {
      const el = $('#flash');
      el.style.background = color;
      el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    }
    bigText(text, color, sub) {
      const el = document.createElement('div');
      el.className = 'big-text';
      el.style.setProperty('--c', color);
      el.innerHTML = (sub ? `<small>${esc(sub)}</small>` : '') + esc(text);
      $('#pops').appendChild(el);
      setTimeout(() => el.remove(), 2200);
    }
    popAt(pid, text, color) {
      const pod = document.getElementById('pod-' + pid);
      if (!pod) return;
      const x = pod.offsetLeft + pod.offsetWidth / 2 + pod.parentElement.offsetLeft;
      const y = pod.parentElement.offsetTop - 10;
      const el = document.createElement('div');
      el.className = 'pop';
      el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.color = color;
      el.textContent = text;
      $('#pops').appendChild(el);
      setTimeout(() => el.remove(), 1800);
    }
    confetti(n) {
      const colors = ['#e43b44', '#41a6f6', '#38b764', '#ffcd75', '#b55088', '#73eff7', '#ef7d57', '#f4f4f4'];
      for (let i = 0; i < n; i++) {
        this.particles.push({ x: 800 + (Math.random() - 0.5) * 600, y: 300 + Math.random() * 100, vx: (Math.random() - 0.5) * 16, vy: -8 - Math.random() * 12, s: 6 + Math.floor(Math.random() * 3) * 3, c: colors[i % colors.length], life: 160 + Math.random() * 80, rot: Math.random() > 0.5 });
      }
    }

    /* ======================= Boucle d'animation ==================== */
    loop(t) {
      requestAnimationFrame((tt) => this.loop(tt));
      const g = this.g;
      // Public
      this.audience.draw(t);
      this.updateMusic();
      // Présentateur : machine à écrire + bouche qui bouge
      let talking = false;
      if (this.typing) {
        const ty = this.typing;
        if (ty.i < ty.text.length && t - ty.last > 28) {
          ty.i += ty.text[ty.i] === ' ' ? 2 : 1;
          ty.last = t;
          if (ty.i % 3 === 0 && g.settings.mode !== 'irl' && !voice.talking) sfx.blip();
        }
        talking = ty.i < ty.text.length || voice.talking;
        patch($('#bubble-text'), esc(ty.text.slice(0, ty.i)) + (talking ? '<span class="caret">▌</span>' : ''));
      }
      const ctx = this.pctx;
      ctx.clearRect(0, 0, this.pcv.width, this.pcv.height);
      const frame = Math.floor(t / 400);
      PQA.drawPresenter(ctx, 0, (frame % 2) * 2, 6, this.expr, talking && Math.floor(t / 110) % 2 === 0, frame);
      // Chrono
      const bar = $('#timerbar');
      if (g.timer && !(g.q && g.q.revealed)) {
        const left = g.timerLeft();
        const ratio = left / g.timer.total;
        bar.style.setProperty('--w', ratio * 100 + '%');
        const sec = Math.ceil(left / 1000);
        bar.classList.add('on');
        bar.classList.toggle('hurry', sec <= 5);
        $('#timer-num').textContent = sec;
        if (sec <= 5 && sec !== this.lastTickSec && sec > 0 && !g.paused) sfx.tick(sec <= 2);
        this.lastTickSec = sec;
      } else { bar.classList.remove('on', 'hurry'); this.lastTickSec = null; }
      // Scores qui défilent
      for (const p of g.activePlayers()) {
        const cur = this.scoreShown[p.id] != null ? this.scoreShown[p.id] : p.score;
        if (cur !== p.score) {
          const next = Math.abs(p.score - cur) < 1 ? p.score : cur + (p.score - cur) * 0.12;
          this.scoreShown[p.id] = next;
          const el = document.querySelector(`.pod-score[data-pid="${p.id}"]`);
          if (el) { el.textContent = fmt(Math.round(next)); el.classList.add('counting'); }
        } else {
          this.scoreShown[p.id] = p.score;
          const el = document.querySelector(`.pod-score[data-pid="${p.id}"]`);
          if (el && el.classList.contains('counting')) { el.classList.remove('counting'); el.textContent = fmt(p.score); }
        }
      }
      // Confettis
      const fx = this.fxc;
      fx.clearRect(0, 0, 1600, 900);
      this.particles = this.particles.filter((pt) => pt.life-- > 0 && pt.y < 920);
      for (const pt of this.particles) {
        pt.vy += 0.35; pt.vx *= 0.99; pt.x += pt.vx; pt.y += pt.vy;
        fx.fillStyle = pt.c;
        const w = pt.rot && Math.floor(t / 100) % 2 ? pt.s / 3 : pt.s;
        fx.fillRect(Math.round(pt.x), Math.round(pt.y), w, pt.s);
      }
    }
  }

  PQA.HostUI = HostUI;
})();
