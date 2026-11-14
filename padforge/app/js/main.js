import { Connection } from './net.js';
import { Engine } from './engine.js';
import { Gyro } from './gyro.js';
import { Editor } from './editor.js';
import { normalizeLayout } from './schema.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('pf:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pf:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---- pairing info: the bridge prints a link like http://192.168.1.5:8080/#k=123456
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('k')) { store.set('token', hash.get('k')); history.replaceState(null, '', location.pathname); }
let token = store.get('token', '');
const clientId = store.get('clientId', null) || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
store.set('clientId', clientId);
const deviceName = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Browser';
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const stage = $('#stage');
const conn = new Connection({ url: wsUrl, token, clientId, name: deviceName });
const gyro = new Gyro();
const engine = new Engine({ stage, conn, gyro, onScreenChange: (id) => { renderTabs(); if (current) store.set('screen:' + current.id, id); } });
const editor = new Editor({
  stage, engine, panel: $('#editor'), toast,
  onSave: saveLayout,
  onDelete: async (id) => {
    try { await conn.request({ t: 'layout.delete', id }); } catch (err) { toast(err.message); }
    localStorage.removeItem('pf:layout:' + id);
    await loadLayout(layoutList.some((l) => l.id === id && l.builtin) ? id : 'standard');
  },
  onClose: (screenId) => { engine.setLayout(current, screenId); renderTabs(); },
});

let current = null;
let layoutList = [];
let welcome = null;
window.padforge = { engine, conn, editor, gyro, get layout() { return current; } };

// ---------------------------------------------------------------- layouts

async function loadLayout(id, { quiet = false } = {}) {
  let l = null;
  if (conn.open) {
    try { l = (await conn.request({ t: 'layout.get', id })).layout; } catch { /* fall back to cache */ }
  }
  if (!l) l = store.get('layout:' + id, null);
  if (!l) { if (!quiet) toast('Layout not available offline'); return; }
  l = normalizeLayout(l);
  store.set('layout:' + id, l);
  store.set('current', id);
  current = l;
  engine.setLayout(l, store.get('screen:' + id, null));
  if (l.gyro.enabled) gyro.start();
  $('#layout-name').textContent = l.name;
  renderTabs();
}

async function saveLayout(l) {
  store.set('layout:' + l.id, l);
  if (!conn.open) throw new Error('not connected to the PC (saved on this phone only)');
  await conn.request({ t: 'layout.save', layout: l });
  current = normalizeLayout(l);
  store.set('current', l.id);
  $('#layout-name').textContent = l.name;
  if (current.gyro.enabled) gyro.start();
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  const l = engine.layout; // the editor's draft while editing
  if (!l) return;
  tabs.hidden = !(editor.open || (l.settings.showTabs && l.screens.length > 1));
  for (const s of l.screens) {
    const b = document.createElement('button');
    b.textContent = s.name;
    b.className = s.id === engine.screenId ? 'on' : '';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); engine.setScreen(s.id); if (editor.open) editor.renderPanel(); });
    tabs.append(b);
  }
}

function renderLayoutSheet() {
  const list = $('#layout-list');
  list.replaceChildren();
  for (const l of layoutList) {
    const b = document.createElement('button');
    b.className = 'layout-item' + (current && l.id === current.id ? ' on' : '');
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = l.name;
    b.lastChild.textContent = [l.builtin ? (l.modified ? 'built-in, edited' : 'built-in') : 'yours', l.match.length ? 'auto: ' + l.match.join(', ') : ''].filter(Boolean).join(' · ');
    b.addEventListener('click', async () => { $('#sheet').hidden = true; await loadLayout(l.id); });
    list.append(b);
  }
  $('#auto-switch').checked = store.get('autoSwitch', true);
}

// ---------------------------------------------------------------- connection

conn.on('status', (s) => {
  const dot = $('#status');
  dot.dataset.state = s;
  $('#start-status').textContent = {
    connecting: 'Connecting to your PC…', open: 'Connected', closed: 'Connection lost, retrying…',
    'auth-failed': 'Wrong pairing code. Check the code shown by the PadForge bridge.', idle: '',
  }[s] || s;
  $('#pair').hidden = s !== 'auth-failed' && !!token;
});
conn.on('latency', (ms) => { $('#latency').textContent = `P${welcome ? welcome.player : '?'} · ${ms} ms`; });
conn.on('welcome', async (msg) => {
  welcome = msg;
  layoutList = msg.layouts;
  $('#output-info').textContent = msg.output.controller + (msg.output.kbm ? ' + keyboard/mouse' : '');
  renderLayoutSheet();
  if (editor.open) return;
  const auto = store.get('autoSwitch', true) && msg.foreground && msg.foreground.layoutId;
  const want = auto || (current && current.id) || store.get('current', null);
  const id = layoutList.some((l) => l.id === want) ? want : (layoutList.find((l) => l.id === 'standard') || layoutList[0] || {}).id;
  if (id) await loadLayout(id);
});
conn.on('layout.list', (msg) => { layoutList = msg.layouts; renderLayoutSheet(); });
conn.on('foreground', async (msg) => {
  if (!store.get('autoSwitch', true) || editor.open || !msg.layoutId || (current && msg.layoutId === current.id)) return;
  await loadLayout(msg.layoutId);
  toast(`Switched to “${current.name}” for ${msg.exe}`);
});

// Game rumble -> phone vibration (Android; iOS web pages can't vibrate).
let rumbleTimer = null;
conn.on('rumble', ({ large = 0, small = 0 }) => {
  const level = Math.max(large, small);
  clearInterval(rumbleTimer);
  if (!navigator.vibrate) return;
  if (level < 0.05) { navigator.vibrate(0); return; }
  const pulse = () => navigator.vibrate(Math.round(30 + 90 * level));
  pulse();
  rumbleTimer = setInterval(pulse, 130);
});

// ---------------------------------------------------------------- chrome

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

async function start() {
  const code = $('#pair-code').value.trim();
  if (code) { token = code; store.set('token', code); conn.token = code; }
  if (!token) { $('#pair').hidden = false; $('#pair-code').focus(); return; }
  $('#start').hidden = true;
  // These need a tap: motion permission (iOS), keep screen awake, full screen + landscape (Android).
  if (await gyro.requestPermission()) gyro.start();
  try { await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
  try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); await screen.orientation?.lock?.('landscape'); } catch { /* iOS: add to home screen instead */ }
  if (conn.status === 'idle' || conn.status === 'auth-failed') conn.connect();
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') { try { await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } }
});

$('#start-btn').addEventListener('click', start);
$('#pair-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('#btn-layouts').addEventListener('click', () => { renderLayoutSheet(); $('#sheet').hidden = false; });
$('#sheet-close').addEventListener('click', () => { $('#sheet').hidden = true; });
$('#auto-switch').addEventListener('change', (e) => store.set('autoSwitch', e.target.checked));
$('#btn-edit').addEventListener('click', () => {
  if (!current) return;
  if (editor.open) { editor.close(); return; }
  editor.start(current, engine.screenId);
  renderTabs();
});
// Inside the PadForge phone app, the corner button goes back to the app's connection screen.
if (window.PadForgeNative) { $('#btn-full').textContent = '⚙'; $('#btn-full').title = 'Connection settings'; }
$('#btn-full').addEventListener('click', () => {
  if (window.PadForgeNative && window.PadForgeNative.setup) { window.PadForgeNative.setup(); return; }
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('On iPhone: Share → Add to Home Screen for full screen'));
});

$('#pair').hidden = !!token;
// Show cached layout immediately so the screen isn't empty while connecting.
const cached = store.get('current', null);
if (cached && store.get('layout:' + cached, null)) loadLayout(cached, { quiet: true });
if (token) conn.connect();
