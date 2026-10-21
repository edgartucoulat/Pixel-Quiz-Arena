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
    return custom ? [custom] : BROKERS;
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

  /** Essaie chaque broker jusqu'à en trouver un qui répond. */
  async function connectAny(clientId) {
    let lastErr;
    for (const url of PQA.relayBrokers()) {
      try { return await new Mqtt(url, clientId).connect(); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('aucun relais');
  }

  function shortId() {
    return 'pqa' + PQA.randomToken().slice(0, 16);
  }

  /* -----------------------------------------------------------------------
   * Côté plateau : une "connexion" par téléphone, qui imite celles de PeerJS
   * (open, send, close, peer) pour que HostNet les traite pareil.
   * --------------------------------------------------------------------- */
  class RelayConn {
    constructor(host, id) {
      this.host = host;
      this.peer = id;
      this.open = true;
      this.relay = true;
    }
    send(msg) { if (this.open) this.host.mqtt.publish(this.host.base + 'c/' + this.peer, JSON.stringify(msg)); }
    close() {
      if (!this.open) return;
      this.send({ t: '_bye' });
      this.open = false;
      this.host.byId.delete(this.peer);
    }
  }

  class RelayHost {
    /** handlers : { onConn(conn), onData(conn, msg), onClose(conn) } */
    constructor(handlers) { this.h = handlers; this.byId = new Map(); }

    async start(code) {
      this.base = TOPIC + code + '/';
      this.mqtt = await connectAny(shortId());
      this.mqtt.subscribe(this.base + 'h/+');
      this.mqtt.onmessage = (topic, text) => {
        const id = topic.slice((this.base + 'h/').length);
        let msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        let conn = this.byId.get(id);
        if (msg.t === '_bye') { if (conn) { conn.open = false; this.byId.delete(id); this.h.onClose(conn); } return; }
        if (!conn) {
          if (msg.t !== 'hello') return; // message d'une ancienne connexion
          conn = new RelayConn(this, id);
          this.byId.set(id, conn);
          this.h.onConn(conn);
        }
        this.h.onData(conn, msg);
      };
      // Broker perdu : on se reconnecte, les téléphones renverront leur "hello".
      this.mqtt.onclose = () => {
        if (this.stopped) return;
        for (const c of Array.from(this.byId.values())) { c.open = false; this.h.onClose(c); }
        this.byId.clear();
        setTimeout(() => !this.stopped && this.start(code).catch(() => this.mqtt.onclose && this.mqtt.onclose()), 2000);
      };
      return code;
    }

    stop() { this.stopped = true; if (this.mqtt) this.mqtt.close(); }
  }

  /* -----------------------------------------------------------------------
   * Côté téléphone : même interface qu'une DataConnection PeerJS.
   * --------------------------------------------------------------------- */
  class RelayClientConn {
    constructor(code) {
      this.base = TOPIC + code + '/';
      this.id = shortId();
      this.open = false;
      this.handlers = {};
    }
    on(ev, fn) { this.handlers[ev] = fn; return this; }
    _emit(ev, arg) { if (this.handlers[ev]) this.handlers[ev](arg); }

    async start() {
      try {
        this.mqtt = await connectAny(this.id);
      } catch (e) { return this._emit('error', e); }
      if (this.closed) return this.mqtt.close();
      this.mqtt.subscribe(this.base + 'c/' + this.id);
      this.mqtt.onmessage = (topic, text) => {
        let msg;
        try { msg = JSON.parse(text); } catch (e) { return; }
        if (msg.t === '_bye') return this._end();
        this._emit('data', msg);
      };
      this.mqtt.onclose = () => this._end();
      this.open = true;
      this._emit('open');
    }

    send(msg) { if (this.open) this.mqtt.publish(this.base + 'h/' + this.id, JSON.stringify(msg)); }

    _end() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      if (this.mqtt) this.mqtt.close();
      this._emit('close');
    }

    close() {
      if (this.closed) return;
      if (this.open) this.send({ t: '_bye' });
      this.closed = true;
      this.open = false;
      if (this.mqtt) setTimeout(() => this.mqtt.close(), 100);
    }
  }

  PQA.RelayHost = RelayHost;
  PQA.RelayClientConn = RelayClientConn;
})();
