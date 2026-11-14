'use strict';
// Linux / Steam Deck: virtual Xbox 360 pads and a keyboard/mouse through /dev/uinput.
// Talks to the kernel directly (ioctl through the koffi FFI), so nothing else needs
// installing on SteamOS. The pads copy the layout of the kernel's own Xbox driver
// (xpad) and use Microsoft's USB ids, so Steam and SDL map them as Xbox 360 pads.
const { EventEmitter } = require('events');
const fs = require('fs');
const { KEYS } = require('../keys');

// <linux/input-event-codes.h>
const EV_SYN = 0, EV_KEY = 1, EV_REL = 2, EV_ABS = 3;
const SYN_REPORT = 0;
const REL_X = 0, REL_Y = 1, REL_WHEEL = 8;
const ABS = { X: 0, Y: 1, Z: 2, RX: 3, RY: 4, RZ: 5, HAT0X: 0x10, HAT0Y: 0x11 };
const BTN_MOUSE = { left: 0x110, right: 0x111, middle: 0x112 };
// Same codes xpad reports (note: X is BTN_X/0x133 and Y is BTN_Y/0x134).
const PAD_BUTTONS = {
  A: 0x130, B: 0x131, X: 0x133, Y: 0x134, LB: 0x136, RB: 0x137,
  BACK: 0x13a, START: 0x13b, GUIDE: 0x13c, LS: 0x13d, RS: 0x13e,
};
const BUS_USB = 0x03;

// <linux/uinput.h> ioctl numbers (x86_64 / arm64 encoding).
const IOW = (nr, size) => (0x40000000 | (size << 16) | (0x55 << 8) | nr) >>> 0;
const UI_DEV_CREATE = 0x5501;
const UI_DEV_DESTROY = 0x5502;
const UI_DEV_SETUP = IOW(3, 92); // struct uinput_setup
const UI_ABS_SETUP = IOW(4, 28); // struct uinput_abs_setup
const UI_SET_EVBIT = IOW(100, 4);
const UI_SET_KEYBIT = IOW(101, 4);
const UI_SET_RELBIT = IOW(102, 4);
const UI_SET_ABSBIT = IOW(103, 4);

const EVENT_SIZE = 24; // struct input_event on 64-bit: timeval(16) + type(2) + code(2) + value(4)

function available() {
  if (process.platform !== 'linux') return 'uinput is Linux only';
  try { fs.accessSync('/dev/uinput', fs.constants.W_OK); } catch {
    return 'no write access to /dev/uinput (see docs/STEAM.md: add the udev rule, then re-login)';
  }
  try { require('koffi'); } catch { return 'koffi module missing (run npm install)'; }
  return null;
}

let ioctlFn = null;
function ioctl(fd, req, arg) {
  if (!ioctlFn) {
    const koffi = require('koffi');
    const libc = koffi.load('libc.so.6');
    ioctlFn = libc.func('int ioctl(int fd, unsigned long req, ...)');
  }
  const r = Buffer.isBuffer(arg) ? ioctlFn(fd, req, 'uint8_t *', arg) : ioctlFn(fd, req, 'int', arg | 0);
  if (r < 0) throw new Error(`ioctl 0x${req.toString(16)} failed`);
}

// Builds and owns one virtual device.
class UDevice {
  constructor({ name, vendor = 0x1209, product = 0x0001, version = 1, keys = [], rels = [], abs = [] }) {
    this.fd = fs.openSync('/dev/uinput', fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    if (keys.length) { ioctl(this.fd, UI_SET_EVBIT, EV_KEY); for (const k of keys) ioctl(this.fd, UI_SET_KEYBIT, k); }
    if (rels.length) { ioctl(this.fd, UI_SET_EVBIT, EV_REL); for (const r of rels) ioctl(this.fd, UI_SET_RELBIT, r); }
    if (abs.length) {
      ioctl(this.fd, UI_SET_EVBIT, EV_ABS);
      for (const a of abs) {
        ioctl(this.fd, UI_SET_ABSBIT, a.code);
        const b = Buffer.alloc(28);
        b.writeUInt16LE(a.code, 0);
        // struct input_absinfo: value, minimum, maximum, fuzz, flat, resolution
        b.writeInt32LE(0, 4); b.writeInt32LE(a.min, 8); b.writeInt32LE(a.max, 12);
        b.writeInt32LE(a.fuzz || 0, 16); b.writeInt32LE(a.flat || 0, 20); b.writeInt32LE(0, 24);
        ioctl(this.fd, UI_ABS_SETUP, b);
      }
    }
    const setup = Buffer.alloc(92);
    setup.writeUInt16LE(BUS_USB, 0); setup.writeUInt16LE(vendor, 2);
    setup.writeUInt16LE(product, 4); setup.writeUInt16LE(version, 6);
    setup.write(name.slice(0, 79), 8, 'latin1');
    ioctl(this.fd, UI_DEV_SETUP, setup);
    ioctl(this.fd, UI_DEV_CREATE, 0);
    this.buf = [];
  }
  ev(type, code, value) {
    const b = Buffer.alloc(EVENT_SIZE);
    b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20);
    this.buf.push(b);
  }
  syn() {
    this.ev(EV_SYN, SYN_REPORT, 0);
    const all = Buffer.concat(this.buf);
    this.buf = [];
    try { fs.writeSync(this.fd, all); } catch (err) { if (err.code !== 'EAGAIN') throw err; }
  }
  close() {
    try { ioctl(this.fd, UI_DEV_DESTROY, 0); } catch { /* already gone */ }
    fs.closeSync(this.fd);
  }
}

const stick = (v, invert) => Math.round((invert ? -v : v) * 32767);

class UInputOutput extends EventEmitter {
  constructor() {
    super();
    const why = available();
    if (why) throw new Error(why);
    this.name = 'uinput';
    this.pads = new Map();
    this.kbm = null;
  }

  describe() { return { output: this.name, controller: 'Xbox 360 (uinput)', gyroPassthrough: false, kbm: true }; }

  plug(slot) {
    this.pads.set(slot, new UDevice({
      name: 'Microsoft X-Box 360 pad', vendor: 0x045e, product: 0x028e, version: 0x110,
      keys: Object.values(PAD_BUTTONS),
      abs: [
        { code: ABS.X, min: -32768, max: 32767, fuzz: 16, flat: 128 },
        { code: ABS.Y, min: -32768, max: 32767, fuzz: 16, flat: 128 },
        { code: ABS.Z, min: 0, max: 255 },
        { code: ABS.RX, min: -32768, max: 32767, fuzz: 16, flat: 128 },
        { code: ABS.RY, min: -32768, max: 32767, fuzz: 16, flat: 128 },
        { code: ABS.RZ, min: 0, max: 255 },
        { code: ABS.HAT0X, min: -1, max: 1 },
        { code: ABS.HAT0Y, min: -1, max: 1 },
      ],
    }));
  }

  unplug(slot) {
    const d = this.pads.get(slot);
    if (d) { d.close(); this.pads.delete(slot); }
  }

  update(slot, s) {
    const d = this.pads.get(slot);
    if (!d) return;
    for (const [name, code] of Object.entries(PAD_BUTTONS)) d.ev(EV_KEY, code, s.buttons.has(name) ? 1 : 0);
    d.ev(EV_ABS, ABS.X, stick(s.lx));
    d.ev(EV_ABS, ABS.Y, stick(s.ly, true)); // evdev: +Y is down
    d.ev(EV_ABS, ABS.RX, stick(s.rx));
    d.ev(EV_ABS, ABS.RY, stick(s.ry, true));
    d.ev(EV_ABS, ABS.Z, Math.round(s.lt * 255));
    d.ev(EV_ABS, ABS.RZ, Math.round(s.rt * 255));
    d.ev(EV_ABS, ABS.HAT0X, s.buttons.has('RIGHT') ? 1 : s.buttons.has('LEFT') ? -1 : 0);
    d.ev(EV_ABS, ABS.HAT0Y, s.buttons.has('UP') ? -1 : s.buttons.has('DOWN') ? 1 : 0);
    d.syn();
  }

  _kbm() {
    if (!this.kbm) {
      this.kbm = new UDevice({
        name: 'PadForge Keyboard/Mouse',
        keys: [...Object.values(KEYS).map((k) => k.evdev), ...Object.values(BTN_MOUSE)],
        rels: [REL_X, REL_Y, REL_WHEEL],
      });
    }
    return this.kbm;
  }

  key(code, down) {
    const k = KEYS[code];
    if (!k) return;
    const d = this._kbm();
    d.ev(EV_KEY, k.evdev, down ? 1 : 0);
    d.syn();
  }

  mouseMove(dx, dy) {
    const d = this._kbm();
    d.ev(EV_REL, REL_X, Math.round(dx));
    d.ev(EV_REL, REL_Y, Math.round(dy));
    d.syn();
  }

  mouseButton(button, down) {
    const code = BTN_MOUSE[button];
    if (!code) return;
    const d = this._kbm();
    d.ev(EV_KEY, code, down ? 1 : 0);
    d.syn();
  }

  wheel(n) {
    const d = this._kbm();
    d.ev(EV_REL, REL_WHEEL, Math.round(n));
    d.syn();
  }

  close() {
    for (const slot of [...this.pads.keys()]) this.unplug(slot);
    if (this.kbm) { this.kbm.close(); this.kbm = null; }
  }
}

module.exports = { UInputOutput, available, UDevice, _ioctlNumbers: { UI_DEV_SETUP, UI_ABS_SETUP, UI_SET_EVBIT, UI_SET_KEYBIT } };
