'use strict';
// Linux: virtual Xbox 360 pads + keyboard/mouse via a small python-evdev helper.
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { KEYS } = require('../keys');

const HELPER = path.join(__dirname, 'uinput_helper.py');

function available() {
  try { fs.accessSync('/dev/uinput', fs.constants.W_OK); } catch { return 'no write access to /dev/uinput'; }
  const r = spawnSync('python3', ['-c', 'import evdev'], { stdio: 'ignore' });
  if (r.status !== 0) return 'python3 module "evdev" not installed (pip install evdev)';
  return null;
}

class UInputOutput extends EventEmitter {
  constructor() {
    super();
    const why = available();
    if (why) throw new Error(why);
    this.name = 'uinput';
    this.proc = spawn('python3', [HELPER], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        if (line.includes('"error"')) console.warn('[uinput]', line);
      }
    });
    this.proc.on('exit', (c) => console.warn('[uinput] helper exited with code', c));
  }
  describe() { return { output: this.name, controller: 'Xbox 360 (uinput)', gyroPassthrough: false, kbm: true }; }
  _send(m) { if (this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(m) + '\n'); }
  plug(slot) { this._send({ op: 'create', slot }); }
  unplug(slot) { this._send({ op: 'destroy', slot }); }
  update(slot, s) {
    this._send({ op: 'pad', slot, b: [...s.buttons], lx: s.lx, ly: s.ly, rx: s.rx, ry: s.ry, lt: s.lt, rt: s.rt });
  }
  key(code, down) { const k = KEYS[code]; if (k) this._send({ op: 'key', code: k.linux, down }); }
  mouseMove(dx, dy) { this._send({ op: 'mouse', dx: Math.round(dx), dy: Math.round(dy) }); }
  mouseButton(button, down) { this._send({ op: 'mbtn', button, down }); }
  wheel(n) { this._send({ op: 'wheel', n: Math.round(n) }); }
  close() { this.proc.stdin.end(); }
}

module.exports = { UInputOutput, available };
