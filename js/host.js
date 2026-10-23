/* =========================================================================
 * PIXEL QUIZ ARENA - Démarrage de l'Écran Plateau
 * Charge les questions, ouvre la salle (PeerJS), relie le réseau au moteur
 * et envoie à chaque téléphone la vue qui le concerne.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = window.PQA;
  const { $, esc } = PQA;
  const SAVE_KEY = 'pqa_host_save';
  /** Mode « Jouer sur téléphones » : ce téléphone héberge la partie et y joue, sans écran TV. */
  const PHONES = new URLSearchParams(location.search).get('phones') === '1';
  if (PHONES) document.body.classList.add('phones');

  /** Charge data/questions/index.json puis chaque fichier de catégorie. */
  async function loadQuestions() {
    const idx = await fetch('data/questions/index.json', { cache: 'no-cache' }).then((r) => r.json());
    const files = await Promise.all(idx.categories.map((c) => fetch('data/questions/' + c.file, { cache: 'no-cache' }).then((r) => r.json()).catch(() => [])));
    const seen = new Set();
    const bank = [];
    files.flat().forEach((q) => {
      if (!q || !q.id || seen.has(q.id) || !q.question) return;
      seen.add(q.id);
      bank.push(q);
    });
    return { bank, categories: idx.categories.map((c) => ({ name: c.name, icon: c.icon })) };
  }

  async function boot() {
    const status = $('#boot-status');
    let data;
    try {
      data = await loadQuestions();
    } catch (e) {
      status.innerHTML = '❌ Impossible de charger les questions. Le jeu doit être servi par un serveur web (GitHub Pages, ou <code>npx serve</code> en local), pas ouvert en double-cliquant sur le fichier.';
      return;
    }
    status.textContent = data.bank.length + ' questions chargées.';
    if (PHONES) {
      $('#btn-open').textContent = '📱 CRÉER LA SALLE';
      $('.boot-sub').textContent = 'Pas besoin de TV : chacun joue sur son téléphone, dans la même pièce ou à distance.';
      $('.boot-tip').textContent = 'Ton téléphone héberge la partie : garde cette page ouverte et l’écran allumé.';
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) {}
    if (saved && Date.now() - saved.at < 3 * 3600 * 1000 && saved.players && saved.players.length) {
      $('#resume').innerHTML = `<button class="big-btn alt" id="btn-resume">↩ Reprendre la partie ${esc(saved.code)} (${saved.players.length} joueurs)</button>`;
      $('#btn-resume').onclick = () => open(data, saved);
    }
    $('#btn-open').disabled = false;
    $('#btn-open').onclick = () => open(data, null);
  }

  async function open(data, saved) {
    PQA.sfx.unlock();
    PQA.tts.init();
    // L'écran d'accueil reste affiché tant que la salle n'est pas ouverte :
    // le plateau n'apparaît qu'une fois prêt et mis à l'échelle de l'écran.
    $('#btn-open').disabled = true;
    if ($('#btn-resume')) $('#btn-resume').disabled = true;
    $('#boot-status').textContent = 'Connexion au serveur de mise en relation...';
    const conns = new Set();
    let ui;
    const game = new PQA.Game(data.bank, data.categories, {
      changed: () => scheduleFlush(),
      fx: (n, d) => ui && ui.fx(n, d),
      say: (text, expr) => { if (ui && !PHONES) ui.say(text, expr); },
      send: (pid, msg) => conns.forEach((c) => c.pid === pid && send(c, msg)),
      toast: (t) => ui && ui.toast(t),
    });
    window.game = game; // pratique pour déboguer dans la console
    PQA.onNetDiag = () => game.changed();

    const net = new PQA.HostNet({
      onMessage(conn, m) {
        if (m.t === 'pong') {
          const rtt = performance.now() - m.h;
          const p = conn.pid && game.players[conn.pid];
          if (p && rtt >= 0 && rtt < 5000) p.rtt = p.rtt * 0.7 + rtt * 0.3;
          return;
        }
        if (m.t === 'hello') return hello(conn, m);
        if (conn.role === 'presenter') { if (m.t === 'pcmd') game.handlePresenter(m); return; }
        if (conn.pid) fromPlayer(conn, m);
      },
      onClose(conn) {
        conns.delete(conn);
        if (conn.role === 'presenter') {
          game.presenter.connected = Array.from(conns).some((c) => c.role === 'presenter');
          game.changed();
        } else if (conn.pid && !Array.from(conns).some((c) => c.pid === conn.pid)) game.setConnected(conn.pid, false);
      },
      onError(err) { console.warn('PeerJS', err); },
    });

    // Envoi vers un téléphone (PeerJS / relais) ou vers la manette intégrée du mode Solo.
    function send(conn, msg) {
      if (conn.localWin) { try { conn.localWin.postMessage({ pqa: msg }, '*'); } catch (e) {} return; }
      net.send(conn, msg);
    }
    // Manette intégrée (mode Solo) : la page play.html dans un cadre, reliée sans réseau.
    const localConn = { localWin: null, _last: null };
    window.addEventListener('message', (e) => {
      const frame = document.getElementById('solo-pad');
      const m = e.data && e.data.pqaLocal;
      if (!m || !frame || e.source !== frame.contentWindow) return;
      localConn.localWin = frame.contentWindow;
      // La manette indique la taille dont elle a besoin (petit buzzer, ou choix à afficher).
      if (m.t === '_pad') { frame.dataset.size = m.size; return; }
      if (m.t === 'hello') { localConn._last = null; hello(localConn, m); const p = game.players[localConn.pid]; if (p) p.rtt = 0; return; }
      if (m.t === 'bye') { conns.delete(localConn); if (localConn.pid) game.setConnected(localConn.pid, false); return; }
      if (m.t === 'owner') return ownerCmd(m);
      if (localConn.pid) fromPlayer(localConn, m);
    });

    // Chat de la partie : le plateau le relaie à tout le monde, et Pixou y met son grain de sel.
    const chat = new PQA.Chat(game, {
      broadcast(msg) {
        conns.forEach((c) => c.role !== 'presenter' && send(c, msg));
        if (ui && !PHONES) ui.chatFeed(msg.m);
      },
      pixouSpeak(text) {
        if (!ui || PHONES) return;
        // Sur la TV : la réplique s'affiche dans le fil du chat, et Pixou la dit quand il ne lit pas de question.
        if (['lobby', 'leaderboard', 'end'].includes(game.phase)) ui.say(text, 'smug');
      },
    });
    game.chat = chat;
    function fromPlayer(conn, m) {
      if (m.t === 'chat') {
        const err = chat.fromPlayer(conn.pid, m.text);
        if (err) send(conn, { t: 'toast', text: err });
        return;
      }
      game.handle(conn.pid, m);
    }

    /* ---- Mode téléphones : la manette de l'hôte règle la partie (à la place du plateau) ---- */
    function ownerInfo() {
      const s = game.settings;
      return {
        code: game.code,
        url: PQA.baseURL() + 'play.html?room=' + game.code + PQA.config.passthroughQuery(),
        mode: s.mode, teams: s.teams, rounds: s.rounds, length: s.length, cards: s.cards, pixou: chat.pixouMode,
        allRounds: PQA.ROUND_ORDER.map((r) => ({ id: r, icon: PQA.ROUNDS[r].icon, name: PQA.ROUNDS[r].short })),
        levels: Object.entries(PQA.BOT_LEVELS).map(([id, L]) => ({ id, icon: L.icon, name: L.name })),
        bots: game.bots().map((b) => ({ id: b.id, name: b.name, color: b.color, level: b.level })),
        players: game.activePlayers().filter((p) => !p.bot).map((p) => ({ id: p.id, name: p.name, color: p.color, team: s.teams ? p.team : null, on: !!(p.connected || p.local), me: p.id === localConn.pid })),
        paused: game.paused,
      };
    }
    const OWNER_ACTS = ['set', 'round', 'botadd', 'botlevel', 'start', 'next', 'pause', 'team', 'shuffleteams', 'lobby'];
    function ownerCmd(m) {
      if (!PHONES || !ui) return;
      if (m.act === 'kick') { if (m.pid !== localConn.pid) game.kick(m.pid); return; }
      if (!OWNER_ACTS.includes(m.act)) return;
      ui.action(m.act, { key: m.key, val: m.val, pid: m.pid });
      game.changed();
    }

    function hello(conn, m) {
      conns.add(conn);
      if (m.role === 'presenter') {
        conn.role = 'presenter';
        game.presenter.connected = true;
        send(conn, { t: 'welcome', role: 'presenter', code: game.code });
        game.changed();
        return;
      }
      const res = game.join({ token: m.token, name: m.name, avatar: m.avatar });
      if (res.error) { send(conn, { t: 'error', text: res.error }); return; }
      // Un seul canal actif par joueur (le plus récent gagne).
      conns.forEach((c) => { if (c !== conn && c.pid === res.p.id) { conns.delete(c); try { c.close(); } catch (e) {} } });
      conn.pid = res.p.id;
      conn._last = null;
      send(conn, { t: 'welcome', role: 'player', token: res.p.token, id: res.p.id, code: game.code, rejoined: res.rejoined });
      send(conn, chat.backlog());
      game.changed();
    }

    // Envoi groupé des vues (une seule fois par "tour" de modifications)
    let flushTimer = null, lastSave = 0;
    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 25);
    }
    function flush() {
      flushTimer = null;
      ui && ui.render();
      const left = game.timer ? Math.round(game.timerLeft()) : null;
      for (const conn of conns) {
        const view = conn.role === 'presenter' ? game.presenterView() : conn.pid ? game.viewFor(conn.pid) : null;
        if (!view) continue;
        if (PHONES && conn === localConn) view.owner = ownerInfo();
        const json = JSON.stringify(view);
        if (json === conn._last) continue;
        conn._last = json;
        send(conn, { t: 'view', v: view, left });
      }
      if (Date.now() - lastSave > 1500) {
        lastSave = Date.now();
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.snapshot())); } catch (e) {}
      }
    }

    let code;
    try {
      code = await net.start(saved ? saved.code : null);
    } catch (err) {
      $('#btn-open').disabled = false;
      $('#boot-status').innerHTML = '❌ Connexion au serveur de mise en relation impossible (' + esc(err.type || err.message) + '). Vérifie ta connexion internet puis recharge la page.';
      return;
    }
    game.code = code;
    if (saved) game.restore(saved);
    game.settings.phones = PHONES;
    if (PHONES) { game.settings.hostPlays = false; game.settings.localDuel = false; if (game.settings.mode === 'irl') game.settings.mode = 'virtual'; }
    ui = new PQA.HostUI(game);
    if (PHONES) {
      // Pas de TV : le son et la voix restent coupés, et les messages du plateau vont sur la manette de l'hôte.
      ui.prefs.muted = true; ui.applyPrefs();
      ui.toast = (text) => localConn.localWin && send(localConn, { t: 'toast', text });
      PQA._wantAwake = true; PQA.keepAwake();
    }
    document.body.classList.add('live');
    $('#boot').classList.add('hide');
    ui.hooks = {
      // Correction manuelle d'une réponse libre mal jugée (clic sur le résultat)
      override(pid) {
        const q = game.q, r = game.round;
        if (!q || game.phase !== 'reveal') return;
        const res = q.results[pid], p = game.players[pid];
        if (!res || !p) return;
        if (res.correct) { p.score -= res.pts; res.correct = false; res.pts = 0; }
        else {
          const base = r.type === 'mystere' ? PQA.pointsFor(r.level) : r.type === 'table' ? r.cellValue : PQA.pointsFor(q.data.difficulte);
          p.score += base; res.correct = true; res.pts = base; res.bonus = 0;
        }
        PQA.sfx.select();
        game.changed();
      },
      /** Retire la manette intégrée et son joueur quand on quitte le mode Solo. */
      dropLocalPad() {
        conns.delete(localConn);
        if (localConn.pid && game.players[localConn.pid] && game.phase === 'lobby') game.kick(localConn.pid);
        localConn.pid = null; localConn.localWin = null;
      },
      backToLobby() {
        game.clearJobs(); game.stopTimer();
        game.phase = 'lobby'; game.round = null; game.q = null; game.paused = false; game.champion = game.runnerUp = null;
        game.activePlayers().forEach((p) => {
          p.score = 0; p.streak = 0; p.bestStreak = 0; p.cards = []; p.stolenBy = null; p.bomb = null; p.shield = false; p.mirror = false;
          p.prevRank = p.curRank = null;
          Object.keys(p.stats).forEach((k) => (p.stats[k] = typeof p.stats[k] === 'boolean' ? false : k === 'fastest' ? null : k === 'worstRank' ? 1 : 0));
        });
        game.changed();
      },
    };
    if (!saved) game.say('welcome', {}, 'happy');
    setInterval(() => { if (game.phase === 'lobby' && !PHONES && Math.random() < 0.35) game.say('lobbyIdle', {}, 'neutral'); }, 20000);
    game.changed();
  }

  boot();
})();
