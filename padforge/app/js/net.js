// WebSocket link to the PC bridge, with auto-reconnect and latency tracking.

export class Connection {
  constructor({ url, token, clientId, name }) {
    Object.assign(this, { url, token, clientId, name });
    this.ws = null;
    this.handlers = new Map();
    this.pending = new Map();
    this.reqSeq = 0;
    this.status = 'idle'; // idle | connecting | open | closed | auth-failed
    this.latency = null;
    this.retry = 0;
    this.stopped = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  _emit(type, data) {
    for (const fn of this.handlers.get(type) || []) fn(data);
  }

  _setStatus(s) {
    this.status = s;
    this._emit('status', s);
  }

  connect() {
    this.stopped = false;
    this._setStatus('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch (err) { this._scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', token: this.token, clientId: this.clientId, name: this.name, v: 1 }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.retry = 0;
        this.clientId = msg.clientId;
        this._setStatus('open');
        this._startPing();
      } else if (msg.t === 'pong') {
        this.latency = Math.round(performance.now() - msg.ts);
        this._emit('latency', this.latency);
      } else if (msg.t === 'error' && msg.code === 'auth') {
        this.stopped = true;
        this._setStatus('auth-failed');
      }
      if (msg.req !== undefined && this.pending.has(msg.req)) {
        const { resolve, reject } = this.pending.get(msg.req);
        this.pending.delete(msg.req);
        msg.t === 'error' ? reject(new Error(msg.message)) : resolve(msg);
      }
      this._emit(msg.t, msg);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      for (const { reject } of this.pending.values()) reject(new Error('connection lost'));
      this.pending.clear();
      if (this.status !== 'auth-failed') this._setStatus('closed');
      if (!this.stopped) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    const delay = Math.min(5000, 300 * 2 ** this.retry++);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ t: 'ping', ts: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  get open() { return this.ws && this.ws.readyState === 1 && this.status === 'open'; }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  request(msg, timeoutMs = 5000) {
    if (!this.open) return Promise.reject(new Error('not connected'));
    const req = ++this.reqSeq;
    return new Promise((resolve, reject) => {
      this.pending.set(req, { resolve, reject });
      this.send({ ...msg, req });
      setTimeout(() => {
        if (this.pending.has(req)) { this.pending.delete(req); reject(new Error('timed out')); }
      }, timeoutMs);
    });
  }

  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}
