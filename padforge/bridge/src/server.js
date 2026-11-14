'use strict';
// PadForge bridge: serves the phone app, accepts phones over WebSocket and
// feeds their input into virtual controllers / keyboard / mouse.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const pad = require('./pad');
const { KEYS, MOUSE_BUTTONS } = require('./keys');
const { LayoutStore } = require('./layouts');
const { watchForeground } = require('./foreground');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const MAX_PLAYERS = 8;
const STALE_MS = 1000; // release everything if a phone goes quiet this long
const RECONNECT_GRACE_MS = 15000; // keep the virtual pad plugged in while a phone reconnects
const AUTH_MAX_FAILS = 5;
const AUTH_LOCKOUT_MS = 60000;

function serveStatic(appDir) {
  return (req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(appDir, urlPath));
    if (!file.startsWith(appDir + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class Bridge {
  constructor({ output, token, layouts = new LayoutStore(), appDir = APP_DIR, foreground = true, log = console.log }) {
    this.output = output;
    this.token = token;
    this.layouts = layouts;
    this.appDir = appDir;
    this.log = log;
    this.players = new Map(); // clientId -> player
    this.keyRefs = new Map(); // key or "mouse:<btn>" -> count, so two phones don't release each other's keys
    this.foregroundExe = null;
    this.servers = [];
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
    // A wrong pairing code locks that address out for a while, so the 6-digit
    // code can't be brute-forced (it controls the PC's keyboard and mouse).
    this.authFails = new Map(); // remote address -> { n, until }
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
    output.on && output.on('rumble', (slot, r) => {
      for (const p of this.players.values()) if (p.slot === slot) this._send(p.ws, { t: 'rumble', ...r });
    });
    this.watchdog = setInterval(() => this._checkStale(), 250);
    this.watchdog.unref();
    if (foreground) {
      this.fg = watchForeground((exe) => {
        this.foregroundExe = exe;
        const layoutId = this.layouts.forProgram(exe);
        this.log(`[bridge] foreground: ${exe}${layoutId ? ` -> layout "${layoutId}"` : ''}`);
        this._broadcast({ t: 'foreground', exe, layoutId });
      });
    }
  }

  // Attach to an http/https server (both may be used at once).
  attach(server) {
    server.on('request', serveStatic(this.appDir));
    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
    this.servers.push(server);
    return server;
  }

  listen({ port = 8080, httpsPort = 0, tls = null, host = '0.0.0.0' } = {}) {
    const started = [];
    const h = this.attach(http.createServer());
    started.push(new Promise((r) => h.listen(port, host, () => r())));
    if (httpsPort && tls) {
      const s = this.attach(https.createServer(tls));
      started.push(new Promise((r) => s.listen(httpsPort, host, () => r())));
    }
    return Promise.all(started).then(() => this.servers.map((s) => s.address().port));
  }

  close() {
    clearInterval(this.watchdog);
    this.fg && this.fg.stop();
    for (const p of this.players.values()) this._dropPlayer(p);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    return Promise.all(this.servers.map((s) => new Promise((r) => s.close(() => r()))));
  }

  _send(ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  _broadcast(msg) {
    for (const p of this.players.values()) this._send(p.ws, msg);
  }

  _freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 1; i <= MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return 0;
  }

  _onConnection(ws, req) {
    let player = null;
    const addr = (req && req.socket && req.socket.remoteAddress) || '?';
    const fail = this.authFails.get(addr);
    if (fail && fail.until > Date.now()) {
      this._send(ws, { t: 'error', code: 'locked', message: 'Too many wrong pairing codes; try again in a minute' });
      ws.close(4029, 'locked out');
      return;
    }
    const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 5000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t !== 'hello') return;
        clearTimeout(authTimer);
        if (!safeEqual(msg.token || '', this.token)) {
          const f = this.authFails.get(addr) || { n: 0, until: 0 };
          f.n += 1;
          if (f.n >= AUTH_MAX_FAILS) { f.n = 0; f.until = Date.now() + AUTH_LOCKOUT_MS; this.log(`[bridge] locked out ${addr} after ${AUTH_MAX_FAILS} wrong codes`); }
          this.authFails.set(addr, f);
          this._send(ws, { t: 'error', code: 'auth', message: 'Wrong pairing code' });
          ws.close(4003, 'bad token');
          return;
        }
        this.authFails.delete(addr);
        player = this._join(ws, msg);
        if (!player) {
          this._send(ws, { t: 'error', code: 'full', message: `All ${MAX_PLAYERS} player slots are in use` });
          ws.close(4004, 'full');
        }
        return;
      }
      try {
        this._handle(player, msg);
      } catch (err) {
        this._send(ws, { t: 'error', code: 'bad-request', message: err.message, ref: msg.t });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!player || player.ws !== ws) return;
      this._releaseInputs(player);
      player.ws = null;
      player.dropTimer = setTimeout(() => this._dropPlayer(player), RECONNECT_GRACE_MS);
      this.log(`[bridge] player ${player.slot} (${player.name}) disconnected`);
    });
  }

  _join(ws, msg) {
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : crypto.randomUUID();
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 40) : 'Phone';
    let p = this.players.get(clientId);
    if (p) {
      clearTimeout(p.dropTimer);
      if (p.ws && p.ws !== ws) p.ws.close(4005, 'replaced by new connection');
      p.ws = ws;
      p.name = name;
    } else {
      const slot = this._freeSlot();
      if (!slot) return null;
      p = { clientId, name, slot, ws, state: pad.neutral(), lastMsg: Date.now(), keys: new Set(), stale: false, dropTimer: null };
      this.output.plug(slot);
      this.players.set(clientId, p);
    }
    p.lastMsg = Date.now();
    this.log(`[bridge] player ${p.slot} (${name}) connected`);
    this._send(ws, {
      t: 'welcome',
      clientId,
      player: p.slot,
      output: this.output.describe(),
      layouts: this.layouts.list(),
      foreground: this.foregroundExe ? { exe: this.foregroundExe, layoutId: this.layouts.forProgram(this.foregroundExe) } : null,
    });
    return p;
  }

  _handle(p, msg) {
    p.lastMsg = Date.now();
    switch (msg.t) {
      case 'pad': {
        // A pad message carries the phone's whole input state: gamepad plus
        // held keys (k) and mouse buttons (m). Sending full state (not events)
        // means a dropped packet or reconnect can never leave a key stuck.
        p.state = pad.sanitize(msg);
        p.stale = false;
        this.output.update(p.slot, p.state);
        const want = new Set();
        if (Array.isArray(msg.k)) for (const k of msg.k.slice(0, 32)) if (KEYS[k]) want.add(k);
        if (Array.isArray(msg.m)) for (const m of msg.m) if (MOUSE_BUTTONS.has(m)) want.add('mouse:' + m);
        for (const id of [...p.keys]) if (!want.has(id)) this._press(p, id, false);
        for (const id of want) if (!p.keys.has(id)) this._press(p, id, true);
        break;
      }
      case 'mouse': {
        const dx = Number(msg.dx), dy = Number(msg.dy);
        if (Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) < 5000 && Math.abs(dy) < 5000) this.output.mouseMove(dx, dy);
        break;
      }
      case 'wheel': {
        const n = Number(msg.n);
        if (Number.isFinite(n) && Math.abs(n) <= 20) this.output.wheel(n);
        break;
      }
      case 'ping':
        this._send(p.ws, { t: 'pong', ts: msg.ts });
        break;
      case 'layout.list':
        this._send(p.ws, { t: 'layout.list', layouts: this.layouts.list() });
        break;
      case 'layout.get': {
        const layout = this.layouts.get(String(msg.id));
        this._send(p.ws, layout ? { t: 'layout', layout, req: msg.req } : { t: 'error', code: 'not-found', message: 'No such layout', ref: 'layout.get', req: msg.req });
        break;
      }
      case 'layout.save':
        this.layouts.save(msg.layout);
        this._send(p.ws, { t: 'layout.saved', id: msg.layout.id, req: msg.req });
        this._broadcast({ t: 'layout.list', layouts: this.layouts.list() });
        break;
      case 'layout.delete':
        this.layouts.delete(String(msg.id));
        this._send(p.ws, { t: 'layout.deleted', id: msg.id, req: msg.req });
        this._broadcast({ t: 'layout.list', layouts: this.layouts.list() });
        break;
      default:
        break;
    }
  }

  // Reference-counted press/release so several phones can share keys safely.
  // id is a key code ("KeyW") or "mouse:<button>".
  _press(p, id, down) {
    if (down === p.keys.has(id)) return;
    const n = this.keyRefs.get(id) || 0;
    if (down) { p.keys.add(id); this.keyRefs.set(id, n + 1); } else { p.keys.delete(id); this.keyRefs.set(id, Math.max(0, n - 1)); }
    const fire = down ? n === 0 : n === 1;
    if (!fire) return;
    if (id.startsWith('mouse:')) this.output.mouseButton(id.slice(6), down);
    else this.output.key(id, down);
  }

  _releaseInputs(p) {
    for (const id of [...p.keys]) this._press(p, id, false);
    if (!pad.isNeutral(p.state)) {
      p.state = pad.neutral();
      this.output.update(p.slot, p.state);
    }
  }

  _checkStale() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (p.ws && !p.stale && now - p.lastMsg > STALE_MS) {
        p.stale = true;
        this._releaseInputs(p);
        this.log(`[bridge] player ${p.slot} went quiet, released all inputs`);
      }
    }
  }

  _dropPlayer(p) {
    clearTimeout(p.dropTimer);
    this._releaseInputs(p);
    this.output.unplug(p.slot);
    this.players.delete(p.clientId);
  }
}

module.exports = { Bridge, APP_DIR };
