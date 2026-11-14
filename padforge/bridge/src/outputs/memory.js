'use strict';
// Output that just records state. Used for tests, for --output log, and as the
// fallback on systems without a virtual controller driver.
const { EventEmitter } = require('events');

class MemoryOutput extends EventEmitter {
  constructor({ verbose = false, kind = 'log' } = {}) {
    super();
    this.name = kind;
    this.verbose = verbose;
    this.pads = new Map(); // slot -> last state
    this.events = []; // keyboard/mouse events, newest last (capped)
  }
  describe() { return { output: this.name, controller: 'none (log only)', gyroPassthrough: false, kbm: true }; }
  plug(slot) { this.pads.set(slot, null); this._log(`pad ${slot} plugged`); }
  unplug(slot) { this.pads.delete(slot); this._log(`pad ${slot} unplugged`); }
  update(slot, s) {
    this.pads.set(slot, s);
    if (this.verbose) {
      const b = [...s.buttons].join(',') || '-';
      const f = (n) => n.toFixed(2);
      this._log(`pad ${slot} [${b}] L(${f(s.lx)},${f(s.ly)}) R(${f(s.rx)},${f(s.ry)}) T(${f(s.lt)},${f(s.rt)})`);
    }
  }
  key(code, down) { this._ev({ type: 'key', code, down }); }
  mouseMove(dx, dy) { this._ev({ type: 'mouse', dx, dy }); }
  mouseButton(button, down) { this._ev({ type: 'mbtn', button, down }); }
  wheel(n) { this._ev({ type: 'wheel', n }); }
  close() {}
  _ev(e) {
    this.events.push(e);
    if (this.events.length > 2000) this.events.splice(0, 1000);
    if (this.verbose && e.type !== 'mouse') this._log(JSON.stringify(e));
  }
  _log(m) { if (this.verbose) console.log('[out]', m); }
}

module.exports = { MemoryOutput };
