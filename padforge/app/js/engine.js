// Input engine: renders a layout, routes multi-touch to controls, swaps screens,
// mixes in motion controls and streams the result to the bridge every frame.
import { bindLabel } from './schema.js';

const DIRS = {
  dpad: { UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT' },
  wasd: { UP: 'key:KeyW', DOWN: 'key:KeyS', LEFT: 'key:KeyA', RIGHT: 'key:KeyD' },
  arrows: { UP: 'key:ArrowUp', DOWN: 'key:ArrowDown', LEFT: 'key:ArrowLeft', RIGHT: 'key:ArrowRight' },
};
const HEARTBEAT_MS = 100;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function newFrame() {
  return { b: new Set(), lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, keys: new Set(), mbtn: new Set(), mdx: 0, mdy: 0, gyroHold: false, gyroOff: false };
}

// Apply a "held" binding (one part of a possibly "+"-joined bind string).
function hold(bind, f) {
  if (!bind) return;
  if (bind === 'LT') f.lt = 1;
  else if (bind === 'RT') f.rt = 1;
  else if (bind.startsWith('key:')) f.keys.add(bind.slice(4));
  else if (bind.startsWith('mouse:')) f.mbtn.add(bind.slice(6));
  else if (bind === 'gyro:hold') f.gyroHold = true;
  else if (bind === 'gyro:off') f.gyroOff = true;
  else if (/^[A-Z]+$/.test(bind)) f.b.add(bind);
}
const splitBinds = (...bs) => bs.filter(Boolean).flatMap((b) => b.split('+')).filter(Boolean);
const isEdge = (b) => b.startsWith('screen:') || b.startsWith('hold:') || b === 'gyro:toggle' || b.startsWith('wheel:');

// Shape a raw stick vector: radial dead zone, outer dead zone, response curve.
export function shapeStick(x, y, { deadzone = 0, outer = 0, curve = 1 }) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) return { x: 0, y: 0, mag: 0 };
  let m = clamp((mag - deadzone) / Math.max(0.01, 1 - deadzone - outer), 0, 1);
  m = Math.pow(m, curve);
  return { x: (x / mag) * m, y: (y / mag) * m, mag: m };
}

function directions(x, y, diagonals = true) {
  const out = [];
  if (Math.hypot(x, y) < 0.3) return out;
  const ang = Math.atan2(y, x); // +y = up
  // 8-way: each direction covers ±67.5° so diagonals press two. 4-way: ±45°.
  const reach = diagonals ? (3 * Math.PI) / 8 : Math.PI / 4;
  const near = (target) => Math.abs(Math.atan2(Math.sin(ang - target), Math.cos(ang - target))) < reach;
  if (near(0)) out.push('RIGHT');
  if (near(Math.PI / 2)) out.push('UP');
  if (near(Math.PI)) out.push('LEFT');
  if (near(-Math.PI / 2)) out.push('DOWN');
  return out;
}

// ---------------------------------------------------------------- controls

class Control {
  constructor(def, engine, layer) {
    this.def = def;
    this.engine = engine;
    this.layer = layer; // 'common' | 'screen'
    this.el = document.createElement('div');
    this.el.className = `ctl ctl-${def.type}`;
    this.el.dataset.cid = def.id;
    this.build();
  }
  build() {}
  place(W, H) {
    const d = this.def;
    const h = (d.s / 100) * H;
    const w = h * (d.a || 1);
    this.w = w; this.h = h;
    Object.assign(this.el.style, {
      width: w + 'px', height: h + 'px', left: (d.x / 100) * W - w / 2 + 'px', top: (d.y / 100) * H - h / 2 + 'px',
      opacity: d.opacity ?? '',
    });
    // Fit the label inside the control (round buttons have less usable width).
    const lbl = this.el.querySelector(':scope > .lbl');
    if (lbl && d.type !== 'stick') {
      const chars = Math.max(1, lbl.textContent.length);
      const usable = w * (d.shape === 'circle' ? 0.72 : 0.86);
      lbl.style.fontSize = Math.max(9, Math.min(h * 0.32, 24, usable / (chars * 0.6))) + 'px';
    }
  }
  local(p) {
    const r = this.el.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top, w: r.width, h: r.height };
  }
  down() {}
  move() {}
  up() {}
  cancel() { this.up(null, true); }
  contribute() {}
  get active() { return false; }
}

class ButtonCtl extends Control {
  build() {
    const d = this.def;
    this.el.classList.add('shape-' + (d.shape || 'circle'));
    this.el.innerHTML = '<span class="lbl"></span>';
    this.el.firstChild.textContent = d.label || bindLabel([d.bind, d.bind2].filter(Boolean).join('+'));
    this.binds = splitBinds(d.bind, d.bind2);
    this.pressed = false;
    this.latched = false;
    this.pointers = 0;
  }
  get slideable() { return !this.binds.some((b) => b.startsWith('screen:') || b.startsWith('hold:')); }
  down() {
    this.pointers++;
    if (this.pointers > 1) return;
    this.pressed = true;
    if (this.def.toggle) this.latched = !this.latched;
    for (const b of this.binds) if (isEdge(b)) this.engine.edge(b, true, this);
    this.engine.haptic();
  }
  up(_p, cancelled) {
    this.pointers = cancelled ? 0 : Math.max(0, this.pointers - 1);
    if (this.pointers > 0) return;
    if (!this.pressed) return;
    this.pressed = false;
    for (const b of this.binds) if (isEdge(b)) this.engine.edge(b, false, this);
  }
  get active() { return this.def.toggle ? this.latched : this.pressed; }
  contribute(f, now) {
    let on = this.active;
    if (on && this.def.turbo) on = Math.floor(now / 50) % 2 === 0;
    this.el.classList.toggle('on', this.active);
    if (on) for (const b of this.binds) if (!isEdge(b)) hold(b, f);
  }
}

class StickCtl extends Control {
  build() {
    this.el.innerHTML = '<div class="base"><div class="knob"></div></div><span class="lbl"></span>';
    this.base = this.el.querySelector('.base');
    this.knob = this.el.querySelector('.knob');
    this.el.querySelector('.lbl').textContent = this.def.label || ({ left: 'L', right: 'R', mouse: 'Mouse', wasd: 'WASD', arrows: 'Arrows', dpad: 'D-pad' }[this.def.bind] || '');
    this.el.classList.toggle('floating', !!this.def.floating);
    this.pid = null;
    this.v = { x: 0, y: 0 };
    this.lastDown = 0;
    this.clicking = false;
  }
  place(W, H) {
    super.place(W, H);
    this.r = this.def.floating ? ((this.def.radius || 14) / 100) * H : Math.min(this.w, this.h) / 2;
    this._center(this.w / 2, this.h / 2);
    this._draw(0, 0);
  }
  _center(cx, cy) {
    this.cx = cx; this.cy = cy;
    Object.assign(this.base.style, { width: this.r * 2 + 'px', height: this.r * 2 + 'px', left: cx - this.r + 'px', top: cy - this.r + 'px' });
  }
  _draw(x, y) { this.knob.style.transform = `translate(${x * this.r}px, ${-y * this.r}px)`; }
  down(p) {
    if (this.pid !== null) return;
    this.pid = p.id;
    const l = this.local(p);
    if (this.def.floating) this._center(l.x, l.y);
    const now = performance.now();
    this.clicking = !!this.def.click && now - this.lastDown < 300;
    this.lastDown = now;
    this.el.classList.add('on');
    this.move(p);
  }
  move(p) {
    if (p.id !== this.pid) return;
    const l = this.local(p);
    let dx = (l.x - this.cx) / this.r;
    let dy = -(l.y - this.cy) / this.r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      if (this.def.follow) this._center(this.cx + (dx / len) * (len - 1) * this.r, this.cy - (dy / len) * (len - 1) * this.r);
      dx /= len; dy /= len;
    }
    this.v = { x: dx, y: dy };
    this._draw(dx, dy);
  }
  up(p, cancelled) {
    if (!cancelled && p && p.id !== this.pid) return;
    this.pid = null;
    this.v = { x: 0, y: 0 };
    this.clicking = false;
    this.el.classList.remove('on');
    if (this.def.floating) this._center(this.w / 2, this.h / 2);
    this._draw(0, 0);
  }
  contribute(f, now, dt) {
    if (this.clicking) for (const b of splitBinds(this.def.click)) hold(b, f);
    const s = shapeStick(this.v.x, this.v.y, this.def);
    if (!s.mag) return;
    const bind = this.def.bind;
    if (bind === 'left') { f.lx += s.x; f.ly += s.y; }
    else if (bind === 'right') { f.rx += s.x; f.ry += s.y; }
    else if (bind === 'mouse') { const sp = 1400 * (this.def.sens || 1); f.mdx += s.x * sp * dt; f.mdy -= s.y * sp * dt; }
    else if (DIRS[bind]) for (const d of directions(s.x, s.y)) hold(DIRS[bind][d], f);
  }
}

class DpadCtl extends Control {
  build() {
    this.el.innerHTML = '<i class="u"></i><i class="d"></i><i class="l"></i><i class="r"></i>';
    this.pid = null;
    this.dirs = [];
  }
  down(p) { if (this.pid === null) { this.pid = p.id; this.move(p); this.engine.haptic(); } }
  move(p) {
    if (p.id !== this.pid) return;
    const l = this.local(p);
    const x = (l.x - l.w / 2) / (l.w / 2);
    const y = -(l.y - l.h / 2) / (l.h / 2);
    const dirs = directions(x, y, this.def.diagonals !== false);
    if (dirs.join() !== this.dirs.join() && dirs.length) this.engine.haptic(4);
    this.dirs = dirs;
    this._draw();
  }
  up(p, cancelled) {
    if (!cancelled && p && p.id !== this.pid) return;
    this.pid = null; this.dirs = []; this._draw();
  }
  _draw() {
    for (const [k, c] of [['UP', 'u'], ['DOWN', 'd'], ['LEFT', 'l'], ['RIGHT', 'r']]) {
      this.el.querySelector('.' + c).classList.toggle('on', this.dirs.includes(k));
    }
  }
  contribute(f) {
    const map = DIRS[this.def.bind] || DIRS.dpad;
    for (const d of this.dirs) hold(map[d], f);
  }
}

class TriggerCtl extends Control {
  build() {
    this.el.innerHTML = '<div class="fill"></div><span class="lbl"></span>';
    this.fill = this.el.querySelector('.fill');
    this.el.querySelector('.lbl').textContent = this.def.label || this.def.bind;
    this.pid = null;
    this.v = 0;
  }
  down(p) { if (this.pid === null) { this.pid = p.id; this.move(p); this.engine.haptic(); } }
  move(p) {
    if (p.id !== this.pid) return;
    if (!this.def.analog) { this.v = 1; } else {
      const l = this.local(p);
      this.v = clamp(1 - l.y / l.h, 0.15, 1);
    }
    this.fill.style.height = this.v * 100 + '%';
    this.el.classList.toggle('on', this.v > 0);
  }
  up(p, cancelled) {
    if (!cancelled && p && p.id !== this.pid) return;
    this.pid = null; this.v = 0; this.fill.style.height = '0'; this.el.classList.remove('on');
  }
  contribute(f) {
    if (!this.v) return;
    if (this.def.bind === 'LT') f.lt = Math.max(f.lt, this.v); else f.rt = Math.max(f.rt, this.v);
  }
}

class TouchpadCtl extends Control {
  build() {
    this.el.innerHTML = '<span class="lbl"></span>';
    this.el.firstChild.textContent = this.def.label || (this.def.bind === 'mouse' ? 'Touchpad' : 'Camera');
    this.pid = null;
    this.last = null;
    this.acc = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
  }
  down(p) {
    if (this.pid !== null) return;
    this.pid = p.id; this.last = { x: p.x, y: p.y }; this.start = { x: p.x, y: p.y, t: performance.now() };
    this.el.classList.add('on');
  }
  move(p) {
    if (p.id !== this.pid) return;
    this.acc.x += p.x - this.last.x;
    this.acc.y += p.y - this.last.y;
    this.last = { x: p.x, y: p.y };
  }
  up(p, cancelled) {
    if (!cancelled && p && p.id !== this.pid) return;
    if (!cancelled && p && this.def.tap && performance.now() - this.start.t < 220 && Math.hypot(p.x - this.start.x, p.y - this.start.y) < 12) {
      this.engine.pulse(this.def.tap, 60);
    }
    this.pid = null;
    this.el.classList.remove('on');
  }
  contribute(f, now, dt) {
    const sens = this.def.sens || 1;
    const { x, y } = this.acc;
    this.acc = { x: 0, y: 0 };
    if (this.def.bind === 'mouse') { f.mdx += x * sens * 1.5; f.mdy += y * sens * 1.5; return; }
    // Stick output: finger speed -> deflection, eased so it doesn't flicker between frames.
    const k = dt > 0 ? 1 / dt / 700 : 0;
    const tx = clamp(x * k * sens, -1, 1), ty = clamp(-y * k * sens, -1, 1);
    this.vel.x += (tx - this.vel.x) * 0.5;
    this.vel.y += (ty - this.vel.y) * 0.5;
    if (this.pid === null) this.vel = { x: 0, y: 0 };
    if (this.def.bind === 'right') { f.rx += this.vel.x; f.ry += this.vel.y; } else { f.lx += this.vel.x; f.ly += this.vel.y; }
  }
}

class LabelCtl extends Control {
  build() { this.el.textContent = this.def.label || ''; }
}

const CLASSES = { button: ButtonCtl, stick: StickCtl, dpad: DpadCtl, trigger: TriggerCtl, touchpad: TouchpadCtl, label: LabelCtl };

// ---------------------------------------------------------------- engine

export class Engine {
  constructor({ stage, conn, gyro, onScreenChange = () => {}, onFrame = () => {} }) {
    Object.assign(this, { stage, conn, gyro, onScreenChange, onFrame });
    this.layout = null;
    this.screenId = null;
    this.controls = []; // live control objects (common + current screen)
    this.byId = new Map();
    this.pointers = new Map(); // pointerId -> control
    this.holdStack = [];
    this.pulses = [];
    this.wheel = 0;
    this.mouseFrac = { x: 0, y: 0 };
    this.gyroToggled = false;
    this.gyroWasActive = false;
    this.lastSent = '';
    this.lastSentAt = 0;
    this.lastMsg = null;
    this.editing = false;
    this.commonLayer = document.createElement('div');
    this.screenLayer = document.createElement('div');
    this.commonLayer.className = 'layer common';
    this.screenLayer.className = 'layer screen';
    stage.append(this.screenLayer, this.commonLayer);
    this._bindPointers();
    new ResizeObserver(() => this.place()).observe(stage);
    this._loop = this._loop.bind(this);
    this.lastT = performance.now();
    requestAnimationFrame(this._loop);
  }

  get screen() { return this.layout && this.layout.screens.find((s) => s.id === this.screenId); }

  setLayout(layout, screenId) {
    this.releaseAll();
    this.layout = layout;
    this.holdStack = [];
    this.gyroToggled = false;
    this.gyro && this.gyro.configure(layout.gyro);
    this.screenId = layout.screens.some((s) => s.id === screenId) ? screenId : layout.screens[0].id;
    this.render();
    this.onScreenChange(this.screenId);
  }

  render() {
    this.commonLayer.replaceChildren();
    this.screenLayer.replaceChildren();
    this.controls = [];
    this.byId.clear();
    if (!this.layout) return;
    const scr = this.screen;
    if (!scr.hideCommon) for (const d of this.layout.common) this._add(d, 'common');
    for (const d of scr.controls) this._add(d, 'screen');
    this.place();
  }

  _add(def, layer) {
    const C = CLASSES[def.type];
    if (!C) return;
    const c = new C(def, this, layer);
    (layer === 'common' ? this.commonLayer : this.screenLayer).append(c.el);
    this.controls.push(c);
    this.byId.set(def.id, c);
  }

  place() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    for (const c of this.controls) c.place(W, H);
  }

  // Switch screen. Controls shared by every screen ("common") keep working, so a
  // thumb on the movement stick isn't interrupted. `keep` survives the switch
  // (the button holding a temporary screen open).
  setScreen(id, keep = null) {
    if (!this.layout || !this.layout.screens.some((s) => s.id === id) || id === this.screenId) return;
    const prevHideCommon = !!this.screen.hideCommon;
    for (const [pid, c] of this.pointers) {
      if (c === keep) continue;
      if (c.layer === 'screen' || prevHideCommon !== !!this.layout.screens.find((s) => s.id === id).hideCommon) {
        c.cancel();
        this.pointers.delete(pid);
      }
    }
    this.screenId = id;
    const commons = this.controls.filter((c) => c.layer === 'common');
    const newHide = !!this.screen.hideCommon;
    if (newHide !== prevHideCommon) { this.render(); }
    else {
      this.screenLayer.replaceChildren();
      this.controls = commons;
      this.byId = new Map(commons.map((c) => [c.def.id, c]));
      for (const d of this.screen.controls) this._add(d, 'screen');
      this.place();
    }
    this.gyro && this.gyro.reset();
    this.onScreenChange(id);
  }

  stepScreen(delta) {
    const list = this.layout.screens;
    const i = list.findIndex((s) => s.id === this.screenId);
    this.setScreen(list[(i + delta + list.length) % list.length].id);
  }

  edge(bind, down, ctl) {
    if (bind === 'gyro:toggle') { if (down) this.gyroToggled = !this.gyroToggled; return; }
    if (bind.startsWith('wheel:')) { if (down) this.wheel += bind === 'wheel:up' ? 1 : -1; return; }
    if (bind === 'screen:next' || bind === 'screen:prev') { if (down) this.stepScreen(bind === 'screen:next' ? 1 : -1); return; }
    if (bind.startsWith('screen:')) { if (down) this.setScreen(bind.slice(7)); return; }
    if (bind.startsWith('hold:')) {
      if (down) {
        this.holdStack.push({ ctl, back: this.screenId });
        this.setScreen(bind.slice(5), ctl);
      } else {
        const i = this.holdStack.findIndex((h) => h.ctl === ctl);
        if (i >= 0) {
          const [h] = this.holdStack.splice(i, 1);
          this.setScreen(h.back);
        }
      }
    }
  }

  pulse(bind, ms) { this.pulses.push({ binds: splitBinds(bind), until: performance.now() + ms }); }

  haptic(ms = 8) {
    if (this.layout && this.layout.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
  }

  releaseAll() {
    for (const c of this.pointers.values()) c.cancel();
    this.pointers.clear();
  }

  _hit(x, y) {
    const el = document.elementFromPoint(x, y);
    const node = el && el.closest('[data-cid]');
    return node && this.stage.contains(node) ? this.byId.get(node.dataset.cid) || null : null;
  }

  _bindPointers() {
    const st = this.stage;
    const P = (e) => ({ id: e.pointerId, x: e.clientX, y: e.clientY });
    st.addEventListener('pointerdown', (e) => {
      if (this.editing) return;
      e.preventDefault();
      const c = this._hit(e.clientX, e.clientY);
      if (!c) return;
      this.pointers.set(e.pointerId, c);
      c.down(P(e));
    });
    st.addEventListener('pointermove', (e) => {
      if (this.editing) return;
      const c = this.pointers.get(e.pointerId);
      if (!c) return;
      // Slide between buttons without lifting (e.g. rolling from A to B).
      if (c instanceof ButtonCtl && this.layout.settings.slide && c.slideable) {
        const n = this._hit(e.clientX, e.clientY);
        if (n && n !== c && n instanceof ButtonCtl && n.slideable) {
          c.up(P(e));
          this.pointers.set(e.pointerId, n);
          n.down(P(e));
          return;
        }
      }
      c.move(P(e));
    });
    const end = (e) => {
      const c = this.pointers.get(e.pointerId);
      if (!c) return;
      this.pointers.delete(e.pointerId);
      c.up(P(e), e.type === 'pointercancel');
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    st.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.layout || this.editing) return;
    const f = newFrame();
    const seen = new Set();
    for (const c of this.controls) { c.contribute(f, now, dt); seen.add(c); }
    for (const c of this.pointers.values()) if (!seen.has(c)) c.contribute(f, now, dt); // e.g. a hold-screen button
    this.pulses = this.pulses.filter((p) => p.until > now);
    for (const p of this.pulses) for (const b of p.binds) if (!isEdge(b)) hold(b, f);

    this._applyGyro(f);

    for (const [x, y] of [['lx', 'ly'], ['rx', 'ry']]) {
      const m = Math.hypot(f[x], f[y]);
      if (m > 1) { f[x] /= m; f[y] /= m; }
    }
    f.lt = clamp(f.lt, 0, 1); f.rt = clamp(f.rt, 0, 1);
    this._send(f, now);
    this.onFrame(f);
  }

  _applyGyro(f) {
    const g = this.gyro;
    const cfg = this.layout.gyro;
    if (!g || !cfg.enabled) return;
    const d = g.take();
    const base = cfg.mode === 'always';
    const active = this.screen.gyro !== false && !f.gyroOff && (f.gyroHold || base !== this.gyroToggled);
    if (active && !this.gyroWasActive) g.reset();
    this.gyroWasActive = active;
    f.gyroActive = active;
    if (!active) return;
    const rate = g.current();
    if (cfg.output === 'mouse') { f.mdx += d.x * cfg.mouseSens; f.mdy -= d.y * cfg.mouseSens; }
    else if (cfg.output === 'right') { f.rx += rate.x / cfg.stickRate; f.ry += rate.y / cfg.stickRate; }
    else if (cfg.output === 'left') { f.lx += rate.x / cfg.stickRate; }
    else if (cfg.output === 'ds4' && g.raw) { f.g = g.raw; f.a = g.accelG; }
  }

  _send(f, now) {
    const r = (v) => Math.round(v * 1000) / 1000;
    const msg = {
      t: 'pad', b: [...f.b], lx: r(f.lx), ly: r(f.ly), rx: r(f.rx), ry: r(f.ry), lt: r(f.lt), rt: r(f.rt),
      k: [...f.keys], m: [...f.mbtn],
    };
    if (f.g) { msg.g = f.g; if (f.a) msg.a = f.a; }
    const json = JSON.stringify(msg);
    this.lastMsg = msg;
    if (json !== this.lastSent || now - this.lastSentAt > HEARTBEAT_MS || msg.g) {
      this.conn && this.conn.send(msg);
      this.lastSent = json;
      this.lastSentAt = now;
    }
    this.mouseFrac.x += f.mdx;
    this.mouseFrac.y += f.mdy;
    const ix = Math.trunc(this.mouseFrac.x), iy = Math.trunc(this.mouseFrac.y);
    if (ix || iy) {
      this.conn && this.conn.send({ t: 'mouse', dx: ix, dy: iy });
      this.mouseFrac.x -= ix; this.mouseFrac.y -= iy;
    }
    if (this.wheel) { this.conn && this.conn.send({ t: 'wheel', n: this.wheel }); this.wheel = 0; }
  }
}
