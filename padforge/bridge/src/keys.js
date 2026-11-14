'use strict';
// Key names follow the browser's KeyboardEvent.code values ("KeyW", "Space", ...).
// Each maps to a Windows virtual-key code (+ extended flag) and a Linux evdev name.

const KEYS = {};
function add(code, vk, linux, ext = false) { KEYS[code] = { vk, linux, ext }; }

for (let i = 0; i < 26; i++) {
  const L = String.fromCharCode(65 + i);
  add('Key' + L, 0x41 + i, 'KEY_' + L);
}
for (let i = 0; i < 10; i++) add('Digit' + i, 0x30 + i, 'KEY_' + i);
for (let i = 1; i <= 12; i++) add('F' + i, 0x6f + i, 'KEY_F' + i);

add('Space', 0x20, 'KEY_SPACE');
add('Enter', 0x0d, 'KEY_ENTER');
add('Escape', 0x1b, 'KEY_ESC');
add('Tab', 0x09, 'KEY_TAB');
add('Backspace', 0x08, 'KEY_BACKSPACE');
add('CapsLock', 0x14, 'KEY_CAPSLOCK');
add('ShiftLeft', 0xa0, 'KEY_LEFTSHIFT');
add('ShiftRight', 0xa1, 'KEY_RIGHTSHIFT');
add('ControlLeft', 0xa2, 'KEY_LEFTCTRL');
add('ControlRight', 0xa3, 'KEY_RIGHTCTRL', true);
add('AltLeft', 0xa4, 'KEY_LEFTALT');
add('AltRight', 0xa5, 'KEY_RIGHTALT', true);
add('ArrowUp', 0x26, 'KEY_UP', true);
add('ArrowDown', 0x28, 'KEY_DOWN', true);
add('ArrowLeft', 0x25, 'KEY_LEFT', true);
add('ArrowRight', 0x27, 'KEY_RIGHT', true);
add('Insert', 0x2d, 'KEY_INSERT', true);
add('Delete', 0x2e, 'KEY_DELETE', true);
add('Home', 0x24, 'KEY_HOME', true);
add('End', 0x23, 'KEY_END', true);
add('PageUp', 0x21, 'KEY_PAGEUP', true);
add('PageDown', 0x22, 'KEY_PAGEDOWN', true);
add('Backquote', 0xc0, 'KEY_GRAVE');
add('Minus', 0xbd, 'KEY_MINUS');
add('Equal', 0xbb, 'KEY_EQUAL');
add('BracketLeft', 0xdb, 'KEY_LEFTBRACE');
add('BracketRight', 0xdd, 'KEY_RIGHTBRACE');
add('Semicolon', 0xba, 'KEY_SEMICOLON');
add('Quote', 0xde, 'KEY_APOSTROPHE');
add('Comma', 0xbc, 'KEY_COMMA');
add('Period', 0xbe, 'KEY_DOT');
add('Slash', 0xbf, 'KEY_SLASH');
add('Backslash', 0xdc, 'KEY_BACKSLASH');

const MOUSE_BUTTONS = new Set(['left', 'right', 'middle']);

module.exports = { KEYS, MOUSE_BUTTONS };
