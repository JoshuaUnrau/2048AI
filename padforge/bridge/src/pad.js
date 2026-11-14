'use strict';
// Normalized gamepad state shared by every output backend.
// Sticks: -1..1 (+x right, +y up). Triggers: 0..1.
// gyro: deg/s {pitch, yaw, roll}; accel: g {x, y, z}. Only used by DS4 passthrough.

const BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LS', 'RS',
  'BACK', 'START', 'GUIDE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'TOUCHPAD',
];
const BUTTON_SET = new Set(BUTTONS);
const AXES = ['lx', 'ly', 'rx', 'ry'];
const TRIGGERS = ['lt', 'rt'];

function neutral() {
  return { buttons: new Set(), lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, gyro: null, accel: null };
}

function num(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < lo ? lo : n > hi ? hi : n;
}

// Turn an untrusted "pad" message from a phone into a clean state object.
function sanitize(msg) {
  const s = neutral();
  if (Array.isArray(msg.b)) {
    for (const b of msg.b) if (BUTTON_SET.has(b)) s.buttons.add(b);
  }
  for (const a of AXES) s[a] = num(msg[a], -1, 1);
  for (const t of TRIGGERS) s[t] = num(msg[t], 0, 1);
  if (msg.g && typeof msg.g === 'object') {
    s.gyro = { pitch: num(msg.g.p, -2000, 2000), yaw: num(msg.g.y, -2000, 2000), roll: num(msg.g.r, -2000, 2000) };
  }
  if (msg.a && typeof msg.a === 'object') {
    s.accel = { x: num(msg.a.x, -4, 4), y: num(msg.a.y, -4, 4), z: num(msg.a.z, -4, 4) };
  }
  return s;
}

function isNeutral(s) {
  return s.buttons.size === 0 && AXES.every((a) => s[a] === 0) && TRIGGERS.every((t) => s[t] === 0);
}

module.exports = { BUTTONS, neutral, sanitize, isNeutral };
