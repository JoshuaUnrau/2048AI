'use strict';
// Picks the best output backend for this OS.
//   x360 / ds4 : ViGEm virtual controllers (Windows)
//   uinput     : Linux virtual controllers
//   log        : no real output, just logs (any OS; used for testing)
//   auto       : x360 on Windows, uinput on Linux, otherwise log
const { MemoryOutput } = require('./memory');

function createOutput(kind = 'auto', { verbose = false } = {}) {
  const tried = [];
  const want = kind === 'auto'
    ? (process.platform === 'win32' ? ['x360'] : process.platform === 'linux' ? ['uinput'] : [])
    : [kind];

  for (const k of want) {
    try {
      if (k === 'x360' || k === 'ds4') {
        let kbm = null;
        try { kbm = new (require('./winkbm').WinKbm)(); } catch (err) { console.warn('[output] keyboard/mouse disabled:', err.message); }
        return new (require('./vigem').ViGEmOutput)({ type: k, kbm });
      }
      if (k === 'uinput') return new (require('./uinput').UInputOutput)();
      if (k === 'log' || k === 'memory') return new MemoryOutput({ verbose: k === 'log' || verbose, kind: k });
      throw new Error('unknown output ' + k);
    } catch (err) {
      tried.push(`${k}: ${err.message}`);
    }
  }
  if (tried.length) {
    console.warn('[output] falling back to log-only output. Reasons:\n  ' + tried.join('\n  '));
    if (process.platform === 'win32') console.warn('  Install ViGEmBus: https://github.com/nefarius/ViGEmBus/releases');
  }
  return new MemoryOutput({ verbose, kind: 'log' });
}

module.exports = { createOutput };
