/* =========================================================================
 * PIXEL QUIZ ARENA - Relais de secours (MQTT sur WebSocket)
 *
 * Si le serveur PeerJS est injoignable (panne, réseau filtrant...), les
 * messages du jeu passent par un "broker" MQTT public et gratuit. Chaque
 * salle utilise ses propres sujets :
 *   pqa1/<CODE>/h/<id>  : messages d'un téléphone vers le plateau
 *   pqa1/<CODE>/c/<id>  : messages du plateau vers ce téléphone
 *
 * Client MQTT 3.1.1 minimal (QoS 0 uniquement), sans dépendance.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  // Brokers publics essayés dans l'ordre. ?relay=ws://hote:port pour un broker perso.
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const TOPIC = 'pqa1/';

  PQA.relayBrokers = function () {
    const custom = new URLSearchParams(location.search).get('relay');
    return custom ? custom.split(',') : BROKERS;
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function str(s) {
    const b = enc.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  }
  function packet(type, body) {
    const len = [];
    let n = body.length;
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
    return new Uint8Array([type, ...len, ...body]);
  }

  /** Connexion MQTT : connect(), subscribe(topic), publish(topic, texte), onmessage(topic, texte). */
  class Mqtt {
    remake() { return new Mqtt(this.url, shortId()); }

    constructor(url, clientId) {
      this.url = url;
      this.clientId = clientId;
      this.buf = new Uint8Array(0);
      this.pid = 1;
      this.onmessage = null;
      this.onclose = null;
      this.closed = false;
    }

    connect(timeout = 8000) {
      // Nom court du broker pour le diagnostic (broker.emqx.io -> emqx)
      let name = this.url;
      try { const u = new URL(this.url), parts = u.hostname.split('.'); name = /^[\d.]+$|^localhost$/.test(u.hostname) ? u.host : parts[parts.length - 2] || parts[0]; } catch (e) {}
      if (!PQA.netDiag.relays[name] || PQA.netDiag.relays[name] !== 'ok') PQA.setDiag(name, 'wait');
      return this._connect(timeout).then((m) => { PQA.setDiag(name, 'ok'); return m; }, (e) => { PQA.setDiag(name, 'ko'); throw e; });
    }

    _connect(timeout) {
      return new Promise((resolve, reject) => {
        let ws;
        try { ws = new WebSocket(this.url, ['mqtt']); } catch (e) { return reject(e); }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        let ready = false;
        const timer = setTimeout(() => { if (!ready) { try { ws.close(); } catch (e) {} reject(new Error('timeout')); } }, timeout);
        ws.onopen = () => {
          // CONNECT : protocole MQTT v4, session propre, keepalive 30 s
          ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(this.clientId)]));
        };
        ws.onmessage = (e) => {
          const chunk = new Uint8Array(e.data);
          const merged = new Uint8Array(this.buf.length + chunk.length);
          merged.set(this.buf); merged.set(chunk, this.buf.length);
          this.buf = merged;
          this._parse((type, body) => {
            if (type === 2 && !ready) { // CONNACK
              ready = true;
              clearTimeout(timer);
              if (body[1] !== 0) return reject(new Error('refus ' + body[1]));
              this._ping = setInterval(() => this._send(new Uint8Array([0xc0, 0])), 20000);
              resolve(this);
            } else if (type === 3) { // PUBLISH
              const tl = (body[0] << 8) | body[1];
              const topic = dec.decode(body.subarray(2, 2 + tl));
              if (this.onmessage) this.onmessage(topic, dec.decode(body.subarray(2 + tl)));
            }
          });
        };
        const end = () => {
          clearTimeout(timer);
          clearInterval(this._ping);
          if (!ready) reject(new Error('fermé'));
          else if (!this.closed) { this.closed = true; if (this.onclose) this.onclose(); }
        };
        ws.onclose = end;
        ws.onerror = end;
      });
    }

    /** Découpe le flux reçu en paquets MQTT complets. */
    _parse(cb) {
      for (;;) {
        const b = this.buf;
        if (b.length < 2) return;
        let len = 0, mult = 1, i = 1, d;
        do {
          if (i >= b.length) return;
          d = b[i++]; len += (d & 127) * mult; mult *= 128;
        } while (d & 128);
        if (b.length < i + len) return;
        cb(b[0] >> 4, b.subarray(i, i + len));
        this.buf = b.slice(i + len);
      }
    }

    _send(bytes) {
      if (this.ws && this.ws.readyState === 1) { this.ws.send(bytes); return true; }
      return false;
    }

    subscribe(topic) {
      const id = this.pid++ & 0xffff || 1;
      this._send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
    }

    publish(topic, text) {
      return this._send(packet(0x30, [...str(topic), ...enc.encode(text)]));
    }

    close() {
      this.closed = true;
      clearInterval(this._ping);
      this._send(new Uint8Array([0xe0, 0])); // DISCONNECT
      try { this.ws.close(); } catch (e) {}
    }
  }

  /** Même interface que Mqtt, mais passe par le serveur de signalisation PeerJS (port 443).
   *  Le serveur relaie tel quel les messages "CANDIDATE" vers le pair visé : quand la liaison
   *  directe WebRTC est bloquée mais que PeerJS répond, les messages du jeu passent par là. */
  class PeerLink {
    constructor(id, code) {
      this.id = id;
      this.code = code;
      this.onmessage = null;
      this.onclose = null;
      this.closed = false;
    }

    remake() { return new PeerLink(this.id, this.code); }

    connect(timeout = 8000) {
      const name = 'peerjs';
      if (PQA.netDiag.relays[name] !== 'ok') PQA.setDiag(name, 'wait');
      return this._connect(timeout).then((m) => { PQA.setDiag(name, 'ok'); return m; }, (e) => { PQA.setDiag(name, 'ko'); throw e; });
    }

    _connect(timeout) {
      return new Promise((resolve, reject) => {
        const o = PQA.config.peerOptions();
        const host = o.host || '0.peerjs.com', port = o.port || 443, path = o.path || '/';
        const secure = o.secure != null ? o.secure : port === 443;
        const url = (secure ? 'wss' : 'ws') + '://' + host + ':' + port + path + 'peerjs?key=' + (o.key || 'peerjs') +
          '&id=' + encodeURIComponent(this.id) + '&token=' + PQA.randomToken().slice(0, 10) + '&version=1.5.5';
        let ws;
        try { ws = new WebSocket(url); } catch (e) { return reject(e); }
        this.ws = ws;
        let ready = false;
        const timer = setTimeout(() => { if (!ready) { try { ws.close(); } catch (e) {} reject(new Error('timeout')); } }, timeout);
        ws.onmessage = (e) => {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (!ready) {
            if (m.type !== 'OPEN') { clearTimeout(timer); try { ws.close(); } catch (err) {} return reject(new Error(m.type)); }
            ready = true;
            clearTimeout(timer);
            this._ping = setInterval(() => this._send({ type: 'HEARTBEAT' }), 5000);
            return resolve(this);
          }
          if (m.type === 'CANDIDATE' && m.payload && m.payload.pqa && this.onmessage) this.onmessage(m.payload.topic, m.payload.text);
        };
        const end = () => {
          clearTimeout(timer);
          clearInterval(this._ping);
          if (!ready) reject(new Error('fermé'));
          else if (!this.closed) { this.closed = true; if (this.onclose) this.onclose(); }
        };
        ws.onclose = end;
        ws.onerror = end;
      });
    }

    _send(obj) {
      if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
      return false;
    }

    subscribe() {} // le serveur PeerJS livre directement à notre identifiant

    publish(topic, text) {
      // pqa1/<CODE>/h/<id> -> le plateau ; pqa1/<CODE>/c/<id> -> ce téléphone
      const m = /\/(h|c)\/([^/]+)$/.exec(topic);
      if (!m) return false;
      const dst = m[1] === 'h' ? peerLinkId(this.code) : peerLinkId(this.code, m[2]);
      return this._send({ type: 'CANDIDATE', dst, payload: { pqa: 1, topic, text } });
    }

    close() {
      this.closed = true;
      clearInterval(this._ping);
      try { this.ws.close(); } catch (e) {}
    }
  }

  /** Identifiant PeerJS du relais : celui du plateau, ou celui d'un téléphone. */
  function peerLinkId(code, clientId) {
    return PQA.config.peerPrefix + code + (clientId ? '-c-' + clientId : '-relais');
  }

  /** Se connecte en parallèle à tous les brokers joignables (le plateau et un téléphone
   *  n'ont pas forcément accès aux mêmes : chacun utilise tous ceux qu'il peut joindre). */
  function connectAll(clientId, code, peerClient) {
    return new Promise((resolve, reject) => {
      const ok = [];
      const links = PQA.relayBrokers().map((url) => new Mqtt(url, clientId));
      links.push(new PeerLink(peerLinkId(code, peerClient), code));
      let pending = links.length, lastErr, grace = null;
      const finish = () => { clearTimeout(grace); grace = -1; resolve(ok.slice()); };
      links.forEach((link) => {
        link.connect().then((m) => {
          if (grace === -1) return m.close(); // arrivé trop tard
          ok.push(m);
          // Un broker répond : on laisse 2 s aux autres, sans attendre ceux qui sont bloqués.
          if (grace === null) grace = setTimeout(finish, 2000);
        }, (e) => { lastErr = e; }).finally(() => {
          if (--pending === 0 && grace !== -1) ok.length ? finish() : reject(lastErr || new Error('aucun relais'));
        });
      });
    });
  }

  function shortId() {
    return 'pqa' + PQA.randomToken().slice(0, 16);
  }

  /* -----------------------------------------------------------------------
   * Côté plateau : une "connexion" par téléphone, qui imite celles de PeerJS
   * (open, send, close, peer) pour que HostNet les traite pareil.
   * Elle répond sur le broker par lequel le téléphone est arrivé.
   * --------------------------------------------------------------------- */
  class RelayConn {
    constructor(host, id, mqtt) {
      this.host = host;
      this.peer = id;
      this.mqtt = mqtt;
      this.open = true;
      this.relay = true;
    }
    send(msg) { if (this.open) this.mqtt.publish(this.host.base + 'c/' + this.peer, JSON.stringify(msg)); }
    close() {
      if (!this.open) return;
      this.send({ t: '_bye' });
      this.open = false;
      this.host.byId.delete(this.peer);
    }
  }

  class RelayHost {
    /** handlers : { onConn(conn), onData(conn, msg), onClose(conn) } */
    constructor(handlers) { this.h = handlers; this.byId = new Map(); this.links = []; }

    async start(code) {
      this.code = code;
      this.base = TOPIC + code + '/';
      const links = await connectAll(shortId(), code);
      links.forEach((m) => this._attach(m));
      return code;
    }

    _attach(mqtt) {
      this.links.push(mqtt);
      mqtt.subscribe(this.base + 'h/+');
      mqtt.onmessage = (topic, text) => {
        const id = topic.slice((this.base + 'h/').length);
        let msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        let conn = this.byId.get(id);
        if (msg.t === '_bye') { if (conn) { conn.open = false; this.byId.delete(id); this.h.onClose(conn); } return; }
        if (!conn) {
          if (msg.t !== 'hello') return; // message d'une ancienne connexion
          conn = new RelayConn(this, id, mqtt);
          this.byId.set(id, conn);
          this.h.onConn(conn);
        }
        if (conn.mqtt !== mqtt) return; // le même "hello" reçu par un autre broker
        this.h.onData(conn, msg);
      };
      // Broker perdu : ses téléphones se reconnecteront et renverront leur "hello".
      mqtt.onclose = () => {
        this.links = this.links.filter((m) => m !== mqtt);
        for (const c of Array.from(this.byId.values())) {
          if (c.mqtt === mqtt) { c.open = false; this.byId.delete(c.peer); this.h.onClose(c); }
        }
        if (!this.stopped) setTimeout(() => this._reconnect(mqtt), 3000);
      };
    }

    _reconnect(old) {
      if (this.stopped) return;
      old.remake().connect().then((m) => (this.stopped ? m.close() : this._attach(m)), () => setTimeout(() => this._reconnect(old), 10000));
    }

    stop() { this.stopped = true; this.links.forEach((m) => m.close()); }
  }

  /* -----------------------------------------------------------------------
   * Côté téléphone : même interface qu'une DataConnection PeerJS.
   * Envoie son "hello" sur tous les brokers joignables et garde celui
   * par lequel le plateau répond.
   * --------------------------------------------------------------------- */
  class RelayClientConn {
    constructor(code) {
      this.code = code;
      this.base = TOPIC + code + '/';
      this.id = shortId();
      this.open = false;
      this.links = [];
      this.mqtt = null; // broker retenu
      this.handlers = {};
    }
    on(ev, fn) { this.handlers[ev] = fn; return this; }
    _emit(ev, arg) { if (this.handlers[ev]) this.handlers[ev](arg); }

    async start() {
      let links;
      try { links = await connectAll(this.id, this.code, this.id); } catch (e) { return this._emit('error', e); }
      this.links = links;
      if (this.closed) return links.forEach((m) => m.close());
      for (const m of links) {
        m.subscribe(this.base + 'c/' + this.id);
        m.onmessage = (topic, text) => {
          let msg;
          try { msg = JSON.parse(text); } catch (e) { return; }
          if (!this.mqtt) {
            // Premier broker par lequel le plateau répond : on ferme les autres.
            this.mqtt = m;
            this.links.filter((o) => o !== m).forEach((o) => { o.onclose = null; o.close(); });
            this.links = [m];
          }
          if (m !== this.mqtt) return;
          if (msg.t === '_bye') return this._end();
          this._emit('data', msg);
        };
        m.onclose = () => {
          this.links = this.links.filter((o) => o !== m);
          if (m === this.mqtt || !this.links.length) this._end();
        };
      }
      this.open = true;
      this._emit('open');
    }

    send(msg) {
      if (!this.open) return;
      const text = JSON.stringify(msg);
      (this.mqtt ? [this.mqtt] : this.links).forEach((m) => m.publish(this.base + 'h/' + this.id, text));
    }

    _end() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.links.forEach((m) => { m.onclose = null; m.close(); });
      this._emit('close');
    }

    close() {
      if (this.closed) return;
      if (this.open) this.send({ t: '_bye' });
      this.closed = true;
      this.open = false;
      const links = this.links;
      links.forEach((m) => { m.onclose = null; });
      setTimeout(() => links.forEach((m) => m.close()), 100);
    }
  }

  PQA.RelayHost = RelayHost;
  PQA.RelayClientConn = RelayClientConn;
})();
