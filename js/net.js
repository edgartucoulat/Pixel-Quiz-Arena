/* =========================================================================
 * PIXEL QUIZ ARENA - Couche réseau (WebRTC via PeerJS)
 *
 * Architecture : l'Écran Plateau (host.html) est le "serveur" de la partie.
 * Il s'enregistre auprès du serveur de signalisation PeerJS sous l'identifiant
 * <prefixe><CODE>. Les téléphones (play.html) et la télécommande
 * (presenter.html) s'y connectent en direct (data channel WebRTC).
 *
 * Si PeerJS est injoignable, le plateau et les téléphones basculent
 * automatiquement sur le relais MQTT de secours (js/relay.js).
 * ?transport=relay force le relais (utile sur un réseau qui bloque WebRTC).
 *
 * Tous les messages sont des objets JSON { t: 'type', ... }.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  // Lettres sans ambiguïté (pas de I, O, 0, 1) pour le code de salle.
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  PQA.config = {
    peerPrefix: 'pixelquizarena-v1-',
    /** Options PeerJS. Par défaut : serveur public gratuit 0.peerjs.com.
     *  Pour un serveur PeerJS perso : ?peer=hote:port (&peersecure=0). */
    peerOptions() {
      const qs = new URLSearchParams(location.search);
      const opts = { debug: 1 };
      const custom = qs.get('peer') || localStorage.getItem('pqa_peer');
      if (custom) {
        const [host, port] = custom.split(':');
        opts.host = host;
        opts.port = Number(port || 443);
        opts.path = qs.get('peerpath') || '/';
        opts.secure = qs.get('peersecure') ? qs.get('peersecure') === '1' : opts.port === 443;
        // Tests locaux : pas besoin de STUN/TURN.
        opts.config = { iceServers: [] };
      }
      return opts;
    },
    /** Paramètres à recopier dans les liens (pour garder le même serveur de signalisation). */
    /** 'relay' si on force le relais de secours, sinon 'p2p'. */
    transport() {
      return new URLSearchParams(location.search).get('transport') === 'relay' ? 'relay' : 'p2p';
    },
    passthroughQuery() {
      const qs = new URLSearchParams(location.search);
      const out = new URLSearchParams();
      ['peer', 'peerpath', 'peersecure', 'relay', 'transport'].forEach((k) => qs.get(k) && out.set(k, qs.get(k)));
      const s = out.toString();
      return s ? '&' + s : '';
    },
  };

  PQA.randomCode = function () {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    return s;
  };

  PQA.randomToken = function () {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* -----------------------------------------------------------------------
   * HostNet : côté Écran Plateau. Accepte les connexions entrantes.
   * --------------------------------------------------------------------- */
  class HostNet {
    constructor(handlers) {
      this.h = handlers; // { onOpen(code), onMessage(conn, msg), onClose(conn), onError(err) }
      this.conns = new Set();
      this.peer = null;
      this.code = null;
      this.destroyed = false;
    }

    /** Ouvre la salle : PeerJS d'abord, puis le relais de secours avec le même code.
     *  La salle est ouverte dès qu'au moins l'un des deux fonctionne. */
    async start(preferredCode) {
      let code = null, p2pErr = null;
      if (PQA.config.transport() === 'p2p') {
        try { code = await this._startPeer(preferredCode); } catch (e) { p2pErr = e; }
      }
      code = code || preferredCode || PQA.randomCode();
      this.code = code;
      const relay = new PQA.RelayHost({
        onConn: (conn) => { conn._lastSeen = Date.now(); this.conns.add(conn); },
        onData: (conn, msg) => { conn._lastSeen = Date.now(); this.h.onMessage(conn, msg); },
        onClose: (conn) => { if (this.conns.delete(conn)) this.h.onClose(conn); },
      });
      const relayReady = relay.start(code).then(() => { this.relay = relay; }, (e) => { if (!this.peer) throw p2pErr || e; });
      // PeerJS fonctionne : le relais s'ouvre en arrière-plan, pour les téléphones qui en auraient besoin.
      if (!this.peer) await relayReady;
      this._heartbeat();
      return code;
    }

    /** Enregistre le plateau auprès de PeerJS. Si le code est pris (ou fourni et indisponible), réessaie. */
    _startPeer(preferredCode, attempt = 0) {
      const code = preferredCode || PQA.randomCode();
      return new Promise((resolve, reject) => {
        const peer = new Peer(PQA.config.peerPrefix + code, PQA.config.peerOptions());
        let opened = false;
        // Le serveur de mise en relation ne répond pas : on abandonne au bout de 12 s.
        const timer = setTimeout(() => { if (!opened) { peer.destroy(); reject({ type: 'délai dépassé' }); } }, 12000);
        peer.on('open', () => {
          clearTimeout(timer);
          opened = true;
          this.peer = peer;
          this._wire(peer);
          resolve(code);
        });
        peer.on('error', (err) => {
          if (opened) return this.h.onError && this.h.onError(err);
          clearTimeout(timer);
          peer.destroy();
          if (err.type === 'unavailable-id' && attempt < 8) {
            // Code déjà utilisé : si on voulait reprendre ce code (rechargement de page),
            // l'ancien identifiant met quelques secondes à se libérer.
            const retryCode = preferredCode && attempt < 5 ? preferredCode : null;
            setTimeout(() => this._startPeer(retryCode, attempt + 1).then(resolve, reject), retryCode ? 2500 : 50);
          } else if (attempt < 2 && err.type !== 'browser-incompatible') {
            setTimeout(() => this._startPeer(preferredCode, attempt + 1).then(resolve, reject), 1500);
          } else reject(err);
        });
      });
    }

    _wire(peer) {
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          this.conns.add(conn);
          conn._lastSeen = Date.now();
        });
        conn.on('data', (data) => {
          conn._lastSeen = Date.now();
          let msg = data;
          if (typeof data === 'string') {
            try { msg = JSON.parse(data); } catch (e) { return; }
          }
          if (msg && typeof msg.t === 'string') this.h.onMessage(conn, msg);
        });
        const closed = () => {
          if (!this.conns.has(conn)) return;
          this.conns.delete(conn);
          this.h.onClose(conn);
        };
        conn.on('close', closed);
        conn.on('error', closed);
        // Certains navigateurs ne signalent pas la fermeture du data channel.
        if (conn.peerConnection) {
          conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
            const st = conn.peerConnection && conn.peerConnection.iceConnectionState;
            if (st === 'failed' || st === 'closed') closed();
          });
        }
      });
      // Perte du serveur de signalisation : les connexions existantes continuent,
      // mais il faut se ré-enregistrer pour accepter les reconnexions.
      peer.on('disconnected', () => {
        if (this.destroyed) return;
        setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000);
      });
    }

    /** Battement de cœur : détection des téléphones partis en veille. */
    _heartbeat() {
      clearInterval(this._hb);
      this._hb = setInterval(() => {
        const now = Date.now();
        for (const conn of Array.from(this.conns)) {
          if (now - conn._lastSeen > 9000) {
            this.conns.delete(conn);
            try { conn.close(); } catch (e) {}
            this.h.onClose(conn);
          } else {
            this.send(conn, { t: 'ping', h: performance.now() });
          }
        }
      }, 2000);
    }

    send(conn, msg) {
      if (conn && conn.open) {
        try { conn.send(msg); } catch (e) { /* canal en cours de fermeture */ }
      }
    }

    destroy() {
      this.destroyed = true;
      clearInterval(this._hb);
      if (this.peer) this.peer.destroy();
      if (this.relay) this.relay.stop();
    }
  }

  /* -----------------------------------------------------------------------
   * ClientNet : côté téléphone / télécommande. Gère la reconnexion auto.
   * --------------------------------------------------------------------- */
  class ClientNet {
    constructor(handlers) {
      this.h = handlers; // { onMessage(msg), onStatus(status, detail), getHello() }
      this.code = null;
      this.peer = null;
      this.conn = null;
      this.status = 'idle';
      this.lastMsg = 0;
      this.retry = 0;
      this.stopped = false;
      // 'p2p' (PeerJS) ou 'relay' (secours MQTT). On bascule de l'un à l'autre en cas d'échec.
      this.mode = PQA.config.transport();
      this.forced = this.mode === 'relay';
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.code && !this.stopped) this.checkHealth(true);
      });
      window.addEventListener('online', () => this.checkHealth(true));
      setInterval(() => this.checkHealth(false), 2000);
    }

    connect(code) {
      this.code = code.toUpperCase();
      this.stopped = false;
      this._open();
    }

    _setStatus(s, detail) {
      this.status = s;
      this.h.onStatus && this.h.onStatus(s, detail);
    }

    _cleanup() {
      // On oublie l'ancienne connexion avant de la fermer : ses événements
      // de fermeture (parfois synchrones) seront ainsi ignorés.
      const conn = this.conn, peer = this.peer;
      this.conn = null;
      this.peer = null;
      if (conn) { try { conn.close(); } catch (e) {} }
      if (peer) { try { peer.destroy(); } catch (e) {} }
    }

    _open() {
      this.openedAt = Date.now();
      this._cleanup();
      clearTimeout(this._retryTimer);
      this._setStatus(this.retry ? 'reconnecting' : 'connecting');
      if (this.mode === 'relay') return this._openRelay();
      const peer = new Peer(PQA.config.peerOptions());
      this.peer = peer;
      let gotConn = false;
      // Serveur PeerJS muet : on passe au relais.
      setTimeout(() => { if (this.peer === peer && !gotConn) this._fail(); }, 9000);
      peer.on('open', () => {
        if (this.peer !== peer) return;
        const conn = peer.connect(PQA.config.peerPrefix + this.code, { serialization: 'json', reliable: true });
        this.conn = conn;
        conn.on('open', () => {
          gotConn = true;
          this.retry = 0;
          this.lastMsg = Date.now();
          this._setStatus('connected');
          conn.send(this.h.getHello());
        });
        conn.on('data', (msg) => {
          this.lastMsg = Date.now();
          if (msg.t === 'ping') return conn.send({ t: 'pong', h: msg.h });
          this.h.onMessage(msg);
        });
        conn.on('close', () => this.conn === conn && this._scheduleRetry());
        conn.on('error', () => this.conn === conn && this._fail());
      });
      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        // Salle introuvable sur PeerJS : le plateau est peut-être joignable par le relais.
        this._fail(err.type === 'peer-unavailable');
      });
      peer.on('disconnected', () => {
        // Signalisation perdue : sans gravité si le canal de données est ouvert.
        if (this.peer === peer && !(this.conn && this.conn.open)) this._fail();
      });
    }

    /** Connexion via le relais MQTT : connectée dès que le plateau répond au "hello". */
    _openRelay() {
      const conn = new PQA.RelayClientConn(this.code);
      this.conn = conn;
      let answered = false;
      conn.on('open', () => {
        if (this.conn !== conn) return;
        this.lastMsg = Date.now();
        conn.send(this.h.getHello());
        setTimeout(() => { if (this.conn === conn && !answered) this._fail(true); }, 6000);
      });
      conn.on('data', (msg) => {
        if (this.conn !== conn) return;
        this.lastMsg = Date.now();
        if (!answered) { answered = true; this.retry = 0; this._setStatus('connected'); }
        if (msg.t === 'ping') return conn.send({ t: 'pong', h: msg.h });
        this.h.onMessage(msg);
      });
      conn.on('close', () => this.conn === conn && this._scheduleRetry());
      conn.on('error', () => this.conn === conn && this._fail());
      conn.start();
    }

    /** Échec de la tentative : on essaie l'autre moyen de connexion au prochain essai. */
    _fail(noRoom) {
      if (!this.forced) {
        if (this.mode === 'relay' && noRoom && this._p2pNoRoom) this._setStatus('noroom');
        this._p2pNoRoom = this.mode === 'p2p' && noRoom;
        this.mode = this.mode === 'p2p' ? 'relay' : 'p2p';
        // Basculer vers le relais tout de suite ; le retour vers PeerJS suit le rythme normal.
        if (this.mode === 'relay') { this._retryTimer = null; this.retry++; return this._open(); }
      }
      this._scheduleRetry(this.status === 'noroom' ? 4000 : 0);
    }

    _scheduleRetry(delay) {
      if (this.stopped) return;
      if (this._retryTimer && this.status === 'reconnecting') return;
      this.retry++;
      const keep = this.status === 'noroom';
      const d = delay || Math.min(800 * Math.pow(1.5, this.retry), 6000);
      if (!keep) this._setStatus('reconnecting');
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(() => { this._retryTimer = null; this._open(); }, d);
    }

    /** Vérifie que l'hôte répond toujours (il envoie un ping toutes les 2 s). */
    checkHealth(force) {
      if (!this.code || this.stopped) return;
      const silent = Date.now() - this.lastMsg > 7000;
      const open = this.conn && this.conn.open;
      // Une tentative est déjà en cours : on la laisse aboutir.
      if (!open && Date.now() - this.openedAt < 8000) return;
      if ((force && (!open || silent)) || (open && silent)) {
        this.retry = Math.max(this.retry, 1);
        this._retryTimer = null;
        this._open();
      }
    }

    send(msg) {
      if (this.conn && this.conn.open) {
        try { this.conn.send(msg); return true; } catch (e) {}
      }
      return false;
    }

    stop() {
      this.stopped = true;
      clearTimeout(this._retryTimer);
      this._cleanup();
    }
  }

  PQA.HostNet = HostNet;
  PQA.ClientNet = ClientNet;
})();
