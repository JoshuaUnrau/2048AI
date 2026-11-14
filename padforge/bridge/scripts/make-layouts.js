// Regenerates the built-in layouts in bridge/layouts/. Run: node scripts/make-layouts.js
const fs = require('fs');
const path = require('path');
let n = 0;
const id = () => 'b' + (++n).toString(36);
const btn = (x, y, s, bind, extra = {}) => ({ id: id(), type: 'button', x, y, s, a: 1, bind, shape: 'circle', ...extra });
const pill = (x, y, s, bind, extra = {}) => btn(x, y, s, bind, { a: 2.1, shape: 'pill', ...extra });
const stick = (x, y, s, bind, extra = {}) => ({ id: id(), type: 'stick', x, y, s, a: 1, bind, floating: false, radius: 14, deadzone: 0.12, outer: 0.05, curve: 1.3, sens: 1, follow: false, ...extra });
const zone = (x, y, s, a, bind, extra = {}) => stick(x, y, s, bind, { a, floating: true, follow: true, ...extra });
const dpad = (x, y, s, bind = 'dpad') => ({ id: id(), type: 'dpad', x, y, s, a: 1, bind, diagonals: true });
const trigger = (x, y, s, a, bind, label, analog = true) => ({ id: id(), type: 'trigger', x, y, s, a, bind, label, analog });
const pad = (x, y, s, a, bind, extra = {}) => ({ id: id(), type: 'touchpad', x, y, s, a, bind, sens: 1, tap: '', ...extra });

const layouts = [
  {
    id: 'standard', name: 'Standard gamepad', match: [],
    gyro: { enabled: false, output: 'right' },
    common: [],
    screens: [
      { id: 'play', name: 'Play', controls: [
        zone(20, 62, 70, 0.85, 'left', { click: 'LS' }),
        stick(66, 74, 30, 'right', { click: 'RS' }),
        btn(86, 34, 14, 'Y'), btn(78, 51, 14, 'X'), btn(94, 51, 14, 'B'), btn(86, 68, 14, 'A'),
        pill(7, 9, 11, 'LT'), pill(21, 9, 11, 'LB'), pill(79, 9, 11, 'RB'), pill(93, 9, 11, 'RT'),
        dpad(43, 74, 30),
        pill(43, 12, 8, 'BACK', { label: '⧉' }), pill(57, 12, 8, 'START', { label: '≡' }), btn(50, 30, 10, 'GUIDE', { label: '⌂' }),
      ] },
      { id: 'menu', name: 'Menu', gyro: false, hideCommon: true, controls: [
        dpad(24, 55, 62),
        btn(76, 66, 26, 'A'), btn(90, 38, 19, 'B'), btn(64, 38, 15, 'X'), btn(76, 18, 13, 'Y'),
        pill(43, 88, 10, 'LB'), pill(57, 88, 10, 'RB'),
        pill(45, 12, 9, 'BACK', { label: '⧉' }), pill(57, 12, 9, 'START', { label: '≡' }),
      ] },
    ],
  },
  {
    id: 'shooter', name: 'Shooter (gyro aim)', match: [],
    gyro: { enabled: true, output: 'right', mode: 'always', stickRate: 140 },
    common: [zone(19, 62, 74, 0.72, 'left', { click: 'LS', label: 'Move' })],
    screens: [
      { id: 'combat', name: 'Combat', controls: [
        btn(86, 66, 25, 'RT', { label: 'Fire' }),
        btn(69, 40, 15, 'LT', { label: 'Aim' }),
        btn(67, 80, 15, 'A', { label: 'Jump' }),
        btn(88, 33, 13, 'X', { label: 'Reload' }),
        btn(52, 82, 13, 'B', { label: 'Crouch' }),
        btn(53, 58, 12, 'Y', { label: 'Swap' }),
        btn(39, 84, 12, 'gyro:off', { label: 'Lift', shape: 'rect' }),
        pill(79, 10, 10, 'RS', { label: 'Melee' }), pill(93, 10, 10, 'RB', { label: 'Grenade' }),
        pill(38, 10, 9, 'BACK', { label: 'Map' }), pill(51, 10, 9, 'START', { label: '≡' }),
        pill(64, 10, 9, 'screen:vehicle', { label: 'Drive' }),
      ] },
      { id: 'vehicle', name: 'Vehicle', gyro: false, controls: [
        trigger(93, 56, 56, 0.32, 'RT', 'Gas'), trigger(80, 56, 56, 0.32, 'LT', 'Brake'),
        stick(58, 68, 30, 'right', { label: 'Look' }),
        btn(58, 36, 13, 'A'), btn(44, 36, 13, 'Y', { label: 'Exit' }), btn(44, 82, 12, 'B'),
        pill(50, 10, 9, 'screen:combat', { label: 'On foot' }), pill(80, 10, 9, 'RB'),
      ] },
      { id: 'menu', name: 'Menu', gyro: false, hideCommon: true, controls: [
        dpad(24, 55, 62),
        btn(76, 66, 26, 'A'), btn(90, 38, 19, 'B'), btn(64, 38, 15, 'X'), btn(76, 18, 13, 'Y'),
        pill(43, 88, 10, 'LB'), pill(57, 88, 10, 'RB'), pill(50, 12, 9, 'START', { label: '≡' }),
      ] },
    ],
  },
  {
    id: 'keyboard-mouse', name: 'Keyboard & mouse', match: [],
    gyro: { enabled: true, output: 'mouse', mode: 'hold', mouseSens: 14 },
    common: [zone(18, 62, 72, 0.72, 'wasd', { label: 'WASD', deadzone: 0.2 })],
    screens: [
      { id: 'main', name: 'Main', controls: [
        pad(64, 46, 66, 1.05, 'mouse', { tap: 'mouse:left', label: 'Mouse' }),
        btn(92, 68, 17, 'mouse:left', { label: 'Click' }),
        btn(92, 42, 13, 'mouse:right+gyro:hold', { label: 'Aim' }),
        pill(78, 89, 10, 'key:Space', { label: 'Jump' }),
        pill(50, 89, 10, 'key:ShiftLeft', { label: 'Shift' }),
        btn(39, 26, 11, 'key:KeyE'), btn(39, 45, 11, 'key:KeyR'), btn(39, 64, 11, 'key:ControlLeft', { label: 'Ctrl' }),
        pill(39, 9, 8, 'key:Tab', { label: 'Tab' }), pill(92, 9, 8, 'key:Escape', { label: 'Esc' }),
        btn(92, 23, 10, 'hold:hotbar', { label: '1–0', shape: 'rect' }),
      ] },
      { id: 'hotbar', name: 'Hotbar', gyro: false, controls: [
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => btn(46 + (i % 5) * 11, i < 5 ? 34 : 62, 15, 'key:Digit' + d, { shape: 'rect' })),
        pill(46, 88, 9, 'key:KeyQ'), pill(60, 88, 9, 'key:KeyF'), pill(74, 88, 9, 'key:KeyG'), pill(88, 88, 9, 'key:KeyM'),
      ] },
    ],
  },
];

const dir = path.join(__dirname, '..', 'layouts');
fs.mkdirSync(dir, { recursive: true });
for (const l of layouts) {
  l.settings = { haptics: true, slide: true, showTabs: true };
  fs.writeFileSync(path.join(dir, l.id + '.json'), JSON.stringify(l, null, 2) + '\n');
}
console.log('wrote', layouts.map((l) => l.id).join(', '));
