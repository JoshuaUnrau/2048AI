'use strict';
// Windows: virtual Xbox 360 or DualShock 4 controllers through the ViGEmBus driver.
// Steam (and Steam Input) sees these as real controllers, so Steam remapping,
// Big Picture and per-game Steam controller configs all work on top of PadForge.
// DS4 mode also forwards the phone's gyro/accelerometer so Steam's own gyro
// settings (gyro-to-mouse, gyro-to-stick, ratcheting) can be used.
const { EventEmitter } = require('events');

const X360_MAP = {
  A: 'A', B: 'B', X: 'X', Y: 'Y',
  LB: 'LEFT_SHOULDER', RB: 'RIGHT_SHOULDER', LS: 'LEFT_THUMB', RS: 'RIGHT_THUMB',
  BACK: 'BACK', START: 'START', GUIDE: 'GUIDE',
};
const DS4_MAP = {
  A: 'CROSS', B: 'CIRCLE', X: 'SQUARE', Y: 'TRIANGLE',
  LB: 'SHOULDER_LEFT', RB: 'SHOULDER_RIGHT', LS: 'THUMB_LEFT', RS: 'THUMB_RIGHT',
  BACK: 'SHARE', START: 'OPTIONS', GUIDE: 'SPECIAL_PS', TOUCHPAD: 'SPECIAL_TOUCHPAD',
};

class ViGEmOutput extends EventEmitter {
  constructor({ type = 'x360', kbm }) {
    super();
    const ViGEmClient = require('vigemclient'); // throws if not installed / not Windows
    this.client = new ViGEmClient();
    const err = this.client.connect();
    if (err) throw new Error('ViGEmBus driver not available: ' + err.message);
    this.type = type;
    this.name = 'vigem-' + type;
    this.kbm = kbm;
    this.pads = new Map();
    // DS4 gyro is time-based, so extended DS4 pads need steady reports.
    if (type === 'ds4') this.tick = setInterval(() => this._tick(), 4);
  }

  describe() {
    return {
      output: this.name,
      controller: this.type === 'ds4' ? 'DualShock 4 (ViGEm)' : 'Xbox 360 (ViGEm)',
      gyroPassthrough: this.type === 'ds4',
      kbm: !!this.kbm,
    };
  }

  plug(slot) {
    const c = this.type === 'ds4' ? this.client.createDS4Controller(true) : this.client.createX360Controller();
    const err = c.connect();
    if (err) throw err;
    c.updateMode = 'manual';
    c.on('vibration', ({ large, small }) => this.emit('rumble', slot, { large: large / 255, small: small / 255 }));
    this.pads.set(slot, { c, last: null });
  }

  unplug(slot) {
    const p = this.pads.get(slot);
    if (!p) return;
    p.c.resetInputs();
    p.c.update();
    p.c.disconnect();
    this.pads.delete(slot);
  }

  update(slot, s) {
    const p = this.pads.get(slot);
    if (!p) return;
    p.last = s;
    this._write(p, s);
  }

  _write(p, s) {
    const c = p.c;
    const map = this.type === 'ds4' ? DS4_MAP : X360_MAP;
    for (const [ours, theirs] of Object.entries(map)) c.button[theirs].setValue(s.buttons.has(ours));
    c.axis.leftX.setValue(s.lx);
    c.axis.leftY.setValue(s.ly);
    c.axis.rightX.setValue(s.rx);
    c.axis.rightY.setValue(s.ry);
    c.axis.leftTrigger.setValue(s.lt);
    c.axis.rightTrigger.setValue(s.rt);
    c.axis.dpadHorz.setValue(s.buttons.has('RIGHT') ? 1 : s.buttons.has('LEFT') ? -1 : 0);
    c.axis.dpadVert.setValue(s.buttons.has('UP') ? 1 : s.buttons.has('DOWN') ? -1 : 0);
    if (this.type === 'ds4') {
      c.button.TRIGGER_LEFT.setValue(s.lt > 0.05);
      c.button.TRIGGER_RIGHT.setValue(s.rt > 0.05);
      if (s.gyro) c.setGyro(s.gyro.pitch, s.gyro.yaw, s.gyro.roll);
      if (s.accel) c.setAccelerometer(s.accel.x, s.accel.y, s.accel.z);
    }
    c.update();
  }

  _tick() {
    for (const p of this.pads.values()) if (p.last && p.last.gyro) p.c.update();
  }

  key(code, down) { this.kbm && this.kbm.key(code, down); }
  mouseMove(dx, dy) { this.kbm && this.kbm.mouseMove(dx, dy); }
  mouseButton(b, down) { this.kbm && this.kbm.mouseButton(b, down); }
  wheel(n) { this.kbm && this.kbm.wheel(n); }

  close() {
    clearInterval(this.tick);
    for (const slot of [...this.pads.keys()]) this.unplug(slot);
    this.client.disconnect();
  }
}

module.exports = { ViGEmOutput };
