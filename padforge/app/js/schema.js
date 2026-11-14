// Control types, their defaults, and the fields the layout editor shows.
// Positions: x, y = centre in % of screen width / height.
// Size: s = height in % of screen height, a = width / height ratio.

export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LS', 'RS', 'BACK', 'START', 'GUIDE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'TOUCHPAD'];

export const KEY_CODES = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => 'Key' + l),
  ...'0123456789'.split('').map((d) => 'Digit' + d),
  ...Array.from({ length: 12 }, (_, i) => 'F' + (i + 1)),
  'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'CapsLock', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Comma',
  'Period', 'Slash', 'Backslash',
];

// Options for a button's "bind" field. Screen entries are added per layout.
export function bindOptions(layout) {
  const groups = [
    { label: 'Gamepad', options: [...PAD_BUTTONS.map((b) => [b, b]), ['LT', 'LT (full)'], ['RT', 'RT (full)']] },
    { label: 'Screens', options: [
      ['screen:next', 'Next screen'], ['screen:prev', 'Previous screen'],
      ...(layout ? layout.screens.flatMap((s) => [['screen:' + s.id, `Go to “${s.name}”`], ['hold:' + s.id, `Show “${s.name}” while held`]]) : []),
    ] },
    { label: 'Gyro', options: [['gyro:hold', 'Gyro on while held'], ['gyro:off', 'Gyro off while held (ratchet)'], ['gyro:toggle', 'Toggle gyro']] },
    { label: 'Mouse', options: [['mouse:left', 'Left click'], ['mouse:right', 'Right click'], ['mouse:middle', 'Middle click'], ['wheel:up', 'Wheel up'], ['wheel:down', 'Wheel down']] },
    { label: 'Keyboard', options: KEY_CODES.map((k) => ['key:' + k, keyLabel(k)]) },
  ];
  return groups;
}

export function keyLabel(code) {
  const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$/, ' L').replace(/Right$/, ' R');
}

export function bindLabel(bind) {
  if (!bind) return '';
  return bind.split('+').map((b) => {
    if (b.startsWith('key:')) return keyLabel(b.slice(4));
    if (b.startsWith('mouse:')) return { left: 'LMB', right: 'RMB', middle: 'MMB' }[b.slice(6)] || b;
    if (b.startsWith('wheel:')) return b === 'wheel:up' ? 'Wheel↑' : 'Wheel↓';
    if (b === 'screen:next') return '›';
    if (b === 'screen:prev') return '‹';
    if (b.startsWith('screen:') || b.startsWith('hold:')) return '▤';
    if (b.startsWith('gyro:')) return 'Gyro';
    return b;
  }).join('+');
}

export const TYPES = {
  button: {
    label: 'Button',
    defaults: { s: 14, a: 1, bind: 'A', label: '', shape: 'circle', toggle: false, turbo: false },
    fields: [
      { key: 'label', type: 'text', label: 'Label (blank = show binding)' },
      { key: 'bind', type: 'bind', label: 'Action' },
      { key: 'bind2', type: 'bind', label: 'Also press (combo)', optional: true },
      { key: 'shape', type: 'select', label: 'Shape', options: [['circle', 'Circle'], ['rect', 'Rounded square'], ['pill', 'Pill']] },
      { key: 'toggle', type: 'check', label: 'Toggle (tap on, tap off)' },
      { key: 'turbo', type: 'check', label: 'Turbo (rapid fire while held)' },
    ],
  },
  stick: {
    label: 'Joystick',
    defaults: { s: 34, a: 1, bind: 'left', floating: false, radius: 14, deadzone: 0.12, outer: 0.05, curve: 1.3, sens: 1, click: 'LS', follow: false },
    fields: [
      { key: 'bind', type: 'select', label: 'Controls', options: [['left', 'Left stick'], ['right', 'Right stick'], ['mouse', 'Mouse'], ['wasd', 'WASD keys'], ['arrows', 'Arrow keys'], ['dpad', 'D-pad']] },
      { key: 'floating', type: 'check', label: 'Floating (centre where thumb lands)' },
      { key: 'follow', type: 'check', label: 'Base follows thumb past the edge' },
      { key: 'radius', type: 'range', label: 'Floating stick size', min: 6, max: 30, step: 1 },
      { key: 'deadzone', type: 'range', label: 'Dead zone', min: 0, max: 0.5, step: 0.01 },
      { key: 'outer', type: 'range', label: 'Outer dead zone', min: 0, max: 0.3, step: 0.01 },
      { key: 'curve', type: 'range', label: 'Response curve (1 = linear)', min: 0.5, max: 3, step: 0.05 },
      { key: 'sens', type: 'range', label: 'Mouse speed (mouse mode)', min: 0.1, max: 4, step: 0.05 },
      { key: 'click', type: 'bind', label: 'Double-tap & hold presses', optional: true },
    ],
  },
  dpad: {
    label: 'D-pad',
    defaults: { s: 30, a: 1, bind: 'dpad', diagonals: true },
    fields: [
      { key: 'bind', type: 'select', label: 'Controls', options: [['dpad', 'D-pad buttons'], ['wasd', 'WASD keys'], ['arrows', 'Arrow keys']] },
      { key: 'diagonals', type: 'check', label: 'Allow diagonals' },
    ],
  },
  trigger: {
    label: 'Trigger',
    defaults: { s: 26, a: 0.45, bind: 'RT', analog: true, label: '' },
    fields: [
      { key: 'label', type: 'text', label: 'Label' },
      { key: 'bind', type: 'select', label: 'Trigger', options: [['LT', 'Left trigger'], ['RT', 'Right trigger']] },
      { key: 'analog', type: 'check', label: 'Analog (slide up to press harder)' },
    ],
  },
  touchpad: {
    label: 'Touchpad',
    defaults: { s: 50, a: 1.4, bind: 'mouse', sens: 1, tap: 'mouse:left', label: '' },
    fields: [
      { key: 'label', type: 'text', label: 'Label' },
      { key: 'bind', type: 'select', label: 'Controls', options: [['mouse', 'Mouse'], ['right', 'Right stick (camera)'], ['left', 'Left stick']] },
      { key: 'sens', type: 'range', label: 'Sensitivity', min: 0.1, max: 5, step: 0.05 },
      { key: 'tap', type: 'bind', label: 'Tap presses', optional: true },
    ],
  },
  label: {
    label: 'Text label',
    defaults: { s: 8, a: 3, label: 'Label' },
    fields: [{ key: 'label', type: 'text', label: 'Text' }],
  },
};

export const COMMON_FIELDS = [
  { key: 'x', type: 'range', label: 'X position %', min: 0, max: 100, step: 0.5 },
  { key: 'y', type: 'range', label: 'Y position %', min: 0, max: 100, step: 0.5 },
  { key: 's', type: 'range', label: 'Size', min: 4, max: 100, step: 0.5 },
  { key: 'a', type: 'range', label: 'Width ratio', min: 0.2, max: 6, step: 0.05 },
  { key: 'opacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.05 },
];

export const GYRO_DEFAULTS = {
  enabled: false, output: 'right', mode: 'always', space: 'player',
  mouseSens: 12, stickRate: 150, smoothing: 4, threshold: 6, deadband: 0.5, roll: 0, invertX: false, invertY: false,
};

export const GYRO_FIELDS = [
  { key: 'enabled', type: 'check', label: 'Use motion controls' },
  { key: 'output', type: 'select', label: 'Motion controls', options: [['right', 'Right stick (camera)'], ['mouse', 'Mouse'], ['left', 'Left stick (steering)'], ['ds4', 'Raw gyro to DS4 (let Steam handle it)']] },
  { key: 'mode', type: 'select', label: 'When', options: [['always', 'Always on'], ['hold', 'Only while a “gyro on” button is held'], ['toggle', 'Off until toggled']] },
  { key: 'space', type: 'select', label: 'Turning axis', options: [['player', 'Player space (works however you hold it)'], ['local', 'Local (rotate the phone itself)']] },
  { key: 'mouseSens', type: 'range', label: 'Mouse: pixels per degree', min: 1, max: 60, step: 0.5 },
  { key: 'stickRate', type: 'range', label: 'Stick: turn speed for full tilt (°/s)', min: 20, max: 720, step: 5 },
  { key: 'roll', type: 'range', label: 'Add steering-wheel roll', min: 0, max: 1, step: 0.05 },
  { key: 'smoothing', type: 'range', label: 'Smoothing (frames)', min: 1, max: 16, step: 1 },
  { key: 'threshold', type: 'range', label: 'Smooth only below (°/s)', min: 0, max: 60, step: 1 },
  { key: 'deadband', type: 'range', label: 'Ignore below (°/s)', min: 0, max: 10, step: 0.1 },
  { key: 'invertX', type: 'check', label: 'Invert horizontal' },
  { key: 'invertY', type: 'check', label: 'Invert vertical' },
];

export const SETTINGS_DEFAULTS = { haptics: true, slide: true, showTabs: true };

export function newId(prefix = 'c') {
  return prefix + Math.random().toString(36).slice(2, 8);
}

export function makeControl(type, extra = {}) {
  return { id: newId(), type, x: 50, y: 50, ...structuredClone(TYPES[type].defaults), ...extra };
}

// Fill in anything missing so old / hand-written layouts still load.
export function normalizeLayout(l) {
  const out = structuredClone(l);
  out.match = out.match || [];
  out.common = out.common || [];
  out.gyro = { ...GYRO_DEFAULTS, ...(out.gyro || {}) };
  out.settings = { ...SETTINGS_DEFAULTS, ...(out.settings || {}) };
  for (const s of out.screens) s.controls = s.controls || [];
  for (const c of [...out.common, ...out.screens.flatMap((s) => s.controls)]) {
    const d = TYPES[c.type] ? TYPES[c.type].defaults : {};
    for (const [k, v] of Object.entries(d)) if (c[k] === undefined) c[k] = structuredClone(v);
    if (!c.id) c.id = newId();
  }
  return out;
}
