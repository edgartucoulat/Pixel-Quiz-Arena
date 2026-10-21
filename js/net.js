/* =========================================================================
 * PIXEL QUIZ ARENA - Couche réseau (WebRTC via PeerJS)
 *
 * Architecture : l'Écran Plateau (host.html) est le "serveur" de la partie.
 * Il s'enregistre auprès du serveur de signalisation PeerJS sous l'identifiant
 * <prefixe><CODE>. Les téléphones (play.html) et la télécommande
 * (presenter.html) s'y connectent en direct (data channel WebRTC).
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
    passthroughQuery() {
      const qs = new URLSearchParams(location.search);
      const out = new URLSearchParams();
      ['peer', 'peerpath', 'peersecure'].forEach((k) => qs.get(k) && out.set(k, qs.get(k)));
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

    /** Démarre le serveur. Si le code est pris (ou fourni et indisponible), réessaie. */
    start(preferredCode, attempt = 0) {
      const code = preferredCode || PQA.randomCode();
      return new Promise((resolve, reject) => {
        const peer = new Peer(PQA.config.peerPrefix + code, PQA.config.peerOptions());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.code = code;
          this._wire(peer);
          resolve(code);
        });
        peer.on('error', (err) => {
          if (opened) return this.h.onError && this.h.onError(err);
          peer.destroy();
          if (err.type === 'unavailable-id' && attempt < 8) {
            // Code déjà utilisé : si on voulait reprendre ce code (rechargement de page),
            // l'ancien identifiant met quelques secondes à se libérer.
            const retryCode = preferredCode && attempt < 5 ? preferredCode : null;
            setTimeout(() => this.start(retryCode, attempt + 1).then(resolve, reject), retryCode ? 2500 : 50);
          } else if (attempt < 3 && err.type !== 'browser-incompatible') {
            setTimeout(() => this.start(preferredCode, attempt + 1).then(resolve, reject), 1500);
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
      // Battement de cœur : détection des téléphones partis en veille.
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
      if (this.conn) { try { this.conn.close(); } catch (e) {} }
      if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
      this.conn = null;
      this.peer = null;
    }

    _open() {
      this.openedAt = Date.now();
      this._cleanup();
      clearTimeout(this._retryTimer);
      this._setStatus(this.retry ? 'reconnecting' : 'connecting');
      const peer = new Peer(PQA.config.peerOptions());
      this.peer = peer;
      let gotConn = false;
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
        conn.on('error', () => this.conn === conn && this._scheduleRetry());
        // Si la connexion n'aboutit pas, on réessaie.
        setTimeout(() => { if (this.conn === conn && !gotConn) this._scheduleRetry(); }, 9000);
      });
      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        if (err.type === 'peer-unavailable') {
          this._setStatus('noroom');
          this._scheduleRetry(4000);
        } else this._scheduleRetry();
      });
      peer.on('disconnected', () => {
        // Signalisation perdue : sans gravité si le canal de données est ouvert.
        if (this.peer === peer && !(this.conn && this.conn.open)) this._scheduleRetry();
      });
    }

    _scheduleRetry(delay) {
      if (this.stopped) return;
      if (this._retryTimer && this.status === 'reconnecting') return;
      this.retry++;
      const d = delay || Math.min(800 * Math.pow(1.5, this.retry), 6000);
      this._setStatus('reconnecting');
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
