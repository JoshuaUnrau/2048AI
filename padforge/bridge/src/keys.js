'use strict';
// Key names follow the browser's KeyboardEvent.code values ("KeyW", "Space", ...).
// Each maps to a Windows virtual-key code (+ extended flag) and a Linux evdev key code.

const KEYS = {};
function add(code, vk, evdev, ext = false) { KEYS[code] = { vk, evdev, ext }; }

// Linux evdev codes for letters, in keyboard-row order (from input-event-codes.h).
const LETTER_EVDEV = {
  Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25,
  A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38,
  Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50,
};
for (let i = 0; i < 26; i++) {
  const L = String.fromCharCode(65 + i);
  add('Key' + L, 0x41 + i, LETTER_EVDEV[L]);
}
for (let i = 0; i < 10; i++) add('Digit' + i, 0x30 + i, i === 0 ? 11 : i + 1);
for (let i = 1; i <= 12; i++) add('F' + i, 0x6f + i, i <= 10 ? 58 + i : 76 + i);

add('Escape', 0x1b, 1);
add('Minus', 0xbd, 12);
add('Equal', 0xbb, 13);
add('Backspace', 0x08, 14);
add('Tab', 0x09, 15);
add('BracketLeft', 0xdb, 26);
add('BracketRight', 0xdd, 27);
add('Enter', 0x0d, 28);
add('ControlLeft', 0xa2, 29);
add('Semicolon', 0xba, 39);
add('Quote', 0xde, 40);
add('Backquote', 0xc0, 41);
add('ShiftLeft', 0xa0, 42);
add('Backslash', 0xdc, 43);
add('Comma', 0xbc, 51);
add('Period', 0xbe, 52);
add('Slash', 0xbf, 53);
add('ShiftRight', 0xa1, 54);
add('AltLeft', 0xa4, 56);
add('Space', 0x20, 57);
add('CapsLock', 0x14, 58);
add('ControlRight', 0xa3, 97, true);
add('AltRight', 0xa5, 100, true);
add('Home', 0x24, 102, true);
add('ArrowUp', 0x26, 103, true);
add('PageUp', 0x21, 104, true);
add('ArrowLeft', 0x25, 105, true);
add('ArrowRight', 0x27, 106, true);
add('End', 0x23, 107, true);
add('ArrowDown', 0x28, 108, true);
add('PageDown', 0x22, 109, true);
add('Insert', 0x2d, 110, true);
add('Delete', 0x2e, 111, true);

const MOUSE_BUTTONS = new Set(['left', 'right', 'middle']);

module.exports = { KEYS, MOUSE_BUTTONS };
