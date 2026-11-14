'use strict';
// Windows keyboard + mouse injection via SendInput (through the koffi FFI).
// Keys are sent as hardware scan codes so DirectInput / raw-input games see them.
const { KEYS } = require('../keys');

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSE_FLAGS = {
  left: [0x0002, 0x0004],
  right: [0x0008, 0x0010],
  middle: [0x0020, 0x0040],
};
const MOUSEEVENTF_WHEEL = 0x0800;
const MAPVK_VK_TO_VSC = 0;

class WinKbm {
  constructor() {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
      dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
    });
    const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
    });
    const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
    koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
    const INPUT = koffi.struct('INPUT', { type: 'uint32', u: 'INPUT_UNION' });
    this.size = koffi.sizeof(INPUT);
    this.SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
    this.MapVirtualKeyW = user32.func('uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)');
    this.scan = {};
  }

  key(code, down) {
    const k = KEYS[code];
    if (!k) return;
    if (this.scan[code] === undefined) this.scan[code] = this.MapVirtualKeyW(k.vk, MAPVK_VK_TO_VSC);
    let flags = KEYEVENTF_SCANCODE | (down ? 0 : KEYEVENTF_KEYUP);
    if (k.ext) flags |= KEYEVENTF_EXTENDEDKEY;
    this.SendInput(1, { type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: this.scan[code], dwFlags: flags, time: 0, dwExtraInfo: 0 } } }, this.size);
  }

  mouseMove(dx, dy) {
    this._mouse({ dx: Math.round(dx), dy: Math.round(dy), dwFlags: MOUSEEVENTF_MOVE });
  }

  mouseButton(button, down) {
    const f = MOUSE_FLAGS[button];
    if (f) this._mouse({ dwFlags: down ? f[0] : f[1] });
  }

  wheel(n) {
    // mouseData is a DWORD but WHEEL_DELTA is signed: wrap negatives.
    this._mouse({ dwFlags: MOUSEEVENTF_WHEEL, mouseData: (Math.round(n * 120) >>> 0) });
  }

  _mouse(mi) {
    this.SendInput(1, { type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: 0, time: 0, dwExtraInfo: 0, ...mi } } }, this.size);
  }
}

module.exports = { WinKbm };
