'use strict';
// End-to-end test: runs the bridge with a recording output and drives the real
// phone app in an emulated landscape phone with multi-touch.
// Run: node test/e2e.js   (needs Playwright + Chromium)
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { Bridge } = require('../src/server');
const { MemoryOutput } = require('../src/outputs/memory');
const { LayoutStore } = require('../src/layouts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || null;

async function until(fn, what, ms = 2000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(20);
  }
  throw new Error('timed out waiting for ' + what + (last instanceof Error ? ': ' + last.message : ''));
}

// Multi-touch through the DevTools protocol (Playwright's tap() is single-touch only).
class Touch {
  constructor(cdp) { this.cdp = cdp; this.points = new Map(); this.nextId = 1; }
  _list() { return [...this.points.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1 })); }
  async down(x, y) {
    const id = this.nextId++;
    this.points.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this._list() });
    return id;
  }
  async move(id, x, y, steps = 5) {
    const p = this.points.get(id);
    const sx = p.x, sy = p.y;
    for (let i = 1; i <= steps; i++) {
      p.x = sx + ((x - sx) * i) / steps;
      p.y = sy + ((y - sy) * i) / steps;
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this._list() });
    }
  }
  // touchEnd releases exactly the points listed.
  async up(id) {
    const p = this.points.get(id);
    this.points.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y }] });
  }
  async tap(x, y, ms = 60) { const id = await this.down(x, y); await sleep(ms); await this.up(id); }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padforge-e2e-'));
  const output = new MemoryOutput();
  const bridge = new Bridge({ output, token: '424242', layouts: new LayoutStore(dir), foreground: false, log: () => {} });
  const [port] = await bridge.listen({ port: 0, host: '127.0.0.1' });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const touch = new Touch(await ctx.newCDPSession(page));
  const pad = () => output.pads.get(1);
  const center = (label, scope = '#stage') => page.evaluate(([label, scope]) => {
    const el = [...document.querySelectorAll(scope + ' .ctl')].find((e) => (e.querySelector('.lbl') || e).textContent.trim() === label);
    if (!el) throw new Error('no control ' + label);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, [label, scope]);
  const loadLayout = async (id) => {
    await page.evaluate(() => document.querySelector('#btn-layouts').click());
    await page.locator('.layout-item', { hasText: { standard: 'Standard', shooter: 'Shooter', 'keyboard-mouse': 'Keyboard', 'war-thunder': 'War Thunder' }[id] }).click();
    await until(() => page.evaluate((id) => window.padforge.layout && window.padforge.layout.id === id, id), 'layout ' + id);
  };
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log('  ✓', name); };

  try {
    await page.goto(`http://127.0.0.1:${port}/#k=424242`);
    await page.locator('#start-btn').click();
    await until(() => page.evaluate(() => window.padforge.conn.status === 'open' && window.padforge.layout), 'connection');
    await until(() => pad() !== undefined, 'virtual pad plugged in');

    await step('standard layout loads with its screens as tabs', async () => {
      assert.strictEqual(await page.evaluate(() => window.padforge.layout.id), 'standard');
      assert.deepStrictEqual(await page.locator('#tabs button').allTextContents(), ['Play', 'Menu']);
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '1-standard.png') });

    await step('holding A presses A on the virtual controller; releasing lets go', async () => {
      const a = await center('A');
      const id = await touch.down(a.x, a.y);
      await until(() => pad() && pad().buttons.has('A'), 'A down');
      await touch.up(id);
      await until(() => pad() && !pad().buttons.has('A'), 'A up');
    });

    await step('multi-touch: floating left stick + right stick + B at once', async () => {
      const zone = await page.evaluate(() => { const r = document.querySelector('.ctl-stick.floating').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const L = await touch.down(zone.x, zone.y);
      await touch.move(L, zone.x + 80, zone.y);
      const rs = await center('R');
      const R = await touch.down(rs.x, rs.y);
      await touch.move(R, rs.x, rs.y - 60);
      const b = await center('B');
      const B = await touch.down(b.x, b.y);
      await until(() => pad().lx > 0.9 && Math.abs(pad().ly) < 0.1 && pad().ry > 0.5 && pad().buttons.has('B'), 'combined state');
      await touch.up(B); await touch.up(R); await touch.up(L);
      await until(() => pad().lx === 0 && pad().ry === 0 && pad().buttons.size === 0, 'all released');
    });

    await step('sliding a finger from X onto A moves the press across', async () => {
      const x = await center('X');
      const a = await center('A');
      const id = await touch.down(x.x, x.y);
      await until(() => pad().buttons.has('X'), 'X');
      await touch.move(id, a.x, a.y, 8);
      await until(() => pad().buttons.has('A') && !pad().buttons.has('X'), 'slid to A');
      await touch.up(id);
    });

    await step('d-pad diagonal presses two directions', async () => {
      const d = await page.evaluate(() => { const r = document.querySelector('.ctl-dpad').getBoundingClientRect(); return { x: r.left + r.width * 0.85, y: r.top + r.height * 0.15 }; });
      const id = await touch.down(d.x, d.y);
      await until(() => pad().buttons.has('UP') && pad().buttons.has('RIGHT'), 'up-right');
      await touch.up(id);
    });

    await step('tab switches screen instantly', async () => {
      await page.locator('#tabs button', { hasText: 'Menu' }).dispatchEvent('pointerdown');
      await until(() => page.evaluate(() => window.padforge.engine.screenId === 'menu'), 'menu screen');
      const a = await center('A');
      assert.ok(a.w > 80, 'menu screen has a big A button');
      await page.locator('#tabs button', { hasText: 'Play' }).dispatchEvent('pointerdown');
    });

    await loadLayout('shooter');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '2-shooter.png') });

    await step('shared movement stick keeps working while swapping to the Vehicle screen', async () => {
      const zone = await page.evaluate(() => { const r = document.querySelector('.layer.common .ctl-stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const L = await touch.down(zone.x, zone.y);
      await touch.move(L, zone.x, zone.y - 80);
      await until(() => pad().ly > 0.9, 'moving forward');
      const drive = await center('Drive');
      await touch.tap(drive.x, drive.y);
      await until(() => page.evaluate(() => window.padforge.engine.screenId === 'vehicle'), 'vehicle screen');
      await sleep(100);
      assert.ok(pad().ly > 0.9, 'still moving after screen swap');
      const gas = await center('Gas');
      const G = await touch.down(gas.x, gas.y - gas.h * 0.4); // near the top = harder
      await until(() => pad().rt > 0.8, 'analog gas');
      await touch.up(G);
      await touch.up(L);
      await until(() => pad().ly === 0 && pad().rt === 0, 'released');
    });

    await step('gyro: rotating the phone moves the right stick; "Lift" ratchet stops it', async () => {
      const foot = await center('On foot');
      await touch.tap(foot.x, foot.y);
      await until(() => page.evaluate(() => window.padforge.engine.screenId === 'combat'), 'combat screen');
      // Simulate turning right in landscape: rotation about the device's x axis (beta).
      const spin = (beta) => page.evaluate((beta) => {
        for (let i = 0; i < 3; i++) {
          const e = new Event('devicemotion');
          e.rotationRate = { alpha: 0, beta, gamma: 0 };
          e.accelerationIncludingGravity = { x: 9.81, y: 0, z: 0 };
          e.interval = 16;
          window.dispatchEvent(e);
        }
      }, beta);
      await page.evaluate(() => Object.defineProperty(screen.orientation, 'angle', { get: () => 90, configurable: true }));
      const stop = setInterval(() => spin(-100).catch(() => {}), 16);
      try {
        await until(() => pad().rx > 0.4, 'gyro to right stick');
        const lift = await center('Lift');
        const id = await touch.down(lift.x, lift.y);
        await until(() => pad().rx === 0, 'ratchet holds gyro off');
        await touch.up(id);
        await until(() => pad().rx > 0.4, 'gyro back on');
      } finally { clearInterval(stop); }
      await until(() => Math.abs(pad().rx) < 0.05, 'gyro settles');
    });

    await loadLayout('keyboard-mouse');
    await step('keyboard & mouse: WASD stick, touchpad mouse, key buttons', async () => {
      output.events.length = 0;
      const zone = await page.evaluate(() => { const r = document.querySelector('.layer.common .ctl-stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const L = await touch.down(zone.x, zone.y);
      await touch.move(L, zone.x - 70, zone.y - 70);
      await until(() => output.events.some((e) => e.code === 'KeyW' && e.down) && output.events.some((e) => e.code === 'KeyA' && e.down), 'W+A');
      await touch.up(L);
      await until(() => output.events.some((e) => e.code === 'KeyW' && !e.down), 'W released');
      const tp = await center('Mouse');
      const T = await touch.down(tp.x, tp.y);
      await touch.move(T, tp.x + 60, tp.y + 20, 6);
      await touch.up(T);
      await until(() => output.events.filter((e) => e.type === 'mouse').reduce((s, e) => s + e.dx, 0) > 50, 'mouse moved right');
      const jump = await center('Jump');
      await touch.tap(jump.x, jump.y, 80);
      await until(() => output.events.some((e) => e.code === 'Space' && e.down) && output.events.some((e) => e.code === 'Space' && !e.down), 'Space tapped');
    });

    await step('"show while held" screen: hold 1–0, press 3 with another finger, release to return', async () => {
      output.events.length = 0;
      const hb = await center('1–0');
      const H = await touch.down(hb.x, hb.y);
      await until(() => page.evaluate(() => window.padforge.engine.screenId === 'hotbar'), 'hotbar shown');
      const three = await center('3');
      await touch.tap(three.x, three.y, 80);
      await until(() => output.events.some((e) => e.code === 'Digit3' && e.down), 'Digit3');
      await touch.up(H);
      await until(() => page.evaluate(() => window.padforge.engine.screenId === 'main'), 'back to main');
    });

    await loadLayout('war-thunder');
    await step('War Thunder: throttle slider stays where you leave it, even across screens', async () => {
      const t = await center('Throttle');
      const id = await touch.down(t.x, t.y + t.h * 0.4);
      await touch.move(id, t.x, t.y - t.h * 0.25, 6); // ~75%
      await touch.up(id);
      await sleep(150);
      const ry = pad().ry;
      assert.ok(ry > 0.35 && ry < 0.65, 'throttle ~75% -> RY ~0.5, got ' + ry);
      await page.locator('#tabs button', { hasText: 'Menu' }).dispatchEvent('pointerdown');
      await sleep(150);
      assert.ok(Math.abs(pad().ry - ry) < 0.01, 'throttle kept on menu screen');
      await page.locator('#tabs button', { hasText: 'Flight' }).dispatchEvent('pointerdown');
      await sleep(150);
      assert.ok(Math.abs(pad().ry - ry) < 0.01, 'throttle kept after returning');
      assert.match(await page.locator('.ctl-trigger .pct').textContent(), /^7\d%$/);
    });

    await step('War Thunder: tilt = roll & pitch, turning = rudder, Centre recentres', async () => {
      const rad = Math.PI / 180;
      // Landscape (angle 90): screen right = device -y, screen up = device +x, normal = +z.
      const motion = (g, w = { alpha: 0, beta: 0, gamma: 0 }, n = 30) => page.evaluate(([g, w, n]) => {
        for (let i = 0; i < n; i++) {
          const e = new Event('devicemotion');
          e.rotationRate = w;
          e.accelerationIncludingGravity = { x: g[0] * 9.81, y: g[1] * 9.81, z: g[2] * 9.81 };
          e.interval = 16;
          window.dispatchEvent(e);
        }
      }, [g, w, n]);
      const level = [Math.cos(40 * rad), 0, Math.sin(40 * rad)]; // held 40° back, wings level
      await motion(level);
      const c = await center('Centre');
      await touch.tap(c.x, c.y);
      await motion(level);
      await until(() => Math.abs(pad().lx) < 0.02 && Math.abs(pad().ly) < 0.02, 'centred');
      // Roll right 20°: right edge dips.
      await motion([Math.cos(40 * rad) * Math.cos(20 * rad), Math.sin(20 * rad), Math.sin(40 * rad) * Math.cos(20 * rad)]);
      await until(() => pad().lx > 0.3 && Math.abs(pad().ly) < 0.05, 'roll right -> left stick X');
      // Lean the top away 15° more: nose down (stick forward).
      await motion([Math.cos(55 * rad), 0, Math.sin(55 * rad)]);
      await until(() => pad().ly > 0.3 && Math.abs(pad().lx) < 0.05, 'pitch -> left stick Y');
      // Turn right around real-world up: rudder.
      const wv = level.map((v) => -v * 100);
      await motion(level, { beta: wv[0], gamma: wv[1], alpha: wv[2] }, 20);
      await until(() => pad().rx > 0.3, 'yaw -> right stick X');
      await motion(level, { alpha: 0, beta: 0, gamma: 0 }, 120); // 2 s still: rudder eases back
      await until(() => Math.abs(pad().rx) < 0.05, 'rudder recentres');
    });

    await step('War Thunder: volume up = light guns, volume down = heavy guns', async () => {
      const key = (type, k) => page.evaluate(([type, k]) => window.dispatchEvent(new KeyboardEvent(type, { key: k })), [type, k]);
      await key('keydown', 'AudioVolumeUp');
      await until(() => pad().rt === 1 && pad().lt === 0, 'MG');
      await key('keydown', 'AudioVolumeDown');
      await until(() => pad().rt === 1 && pad().lt === 1, 'both');
      await key('keyup', 'AudioVolumeUp');
      await key('keyup', 'AudioVolumeDown');
      await until(() => pad().rt === 0 && pad().lt === 0, 'released');
      const flaps = await center('Flaps ▼');
      const id = await touch.down(flaps.x, flaps.y);
      await until(() => pad().buttons.has('DOWN'), 'flaps down');
      await touch.up(id);
      await until(() => !pad().buttons.has('DOWN'), 'flaps button released');
      await sleep(50);
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '4-war-thunder.png') });

    await step('editor: drag a control, relabel it, add a screen, save to the PC', async () => {
      await loadLayout('standard');
      await page.locator('#btn-edit').click();
      await until(() => page.locator('#editor').isVisible(), 'editor open');
      await page.locator('#editor .swap-side').click(); // A sits under the panel; move the panel left
      const a = await center('A');
      // Drag A left by ~10% of the screen.
      const id = await touch.down(a.x, a.y);
      await touch.move(id, a.x - 84, a.y, 6);
      await touch.up(id);
      const def = await page.evaluate(() => window.padforge.engine.layout.screens[0].controls.find((c) => c.bind === 'A'));
      assert.ok(def.x < 80 && def.x > 70, 'A moved, x=' + def.x);
      await page.locator('#editor label.row', { hasText: 'Label' }).locator('input').fill('Jump');
      await page.locator('#editor label.row', { hasText: 'Label' }).locator('input').dispatchEvent('change');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '3-editor.png') });
      await page.locator('.ed-tabs button', { hasText: 'Screens' }).click();
      await page.locator('#editor button', { hasText: '+ Add screen' }).click();
      await page.locator('#editor .save').click();
      await until(() => fs.existsSync(path.join(dir, 'standard.json')), 'saved file');
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'standard.json')));
      assert.strictEqual(saved.screens.length, 3);
      assert.strictEqual(saved.screens[0].controls.find((c) => c.bind === 'A').label, 'Jump');
      await page.locator('#editor button', { hasText: 'Done' }).click();
      assert.deepStrictEqual(await page.locator('#tabs button').allTextContents(), ['Play', 'Menu', 'Screen 3']);
      await page.locator('#tabs button', { hasText: 'Play' }).dispatchEvent('pointerdown');
      const jumpBtn = await center('Jump');
      const J = await touch.down(jumpBtn.x, jumpBtn.y);
      await until(() => pad().buttons.has('A'), 'edited button still presses A');
      await touch.up(J);
    });

    await step('rumble from the game reaches the phone', async () => {
      await page.evaluate(() => { window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; });
      output.emit('rumble', 1, { large: 0.8, small: 0 });
      await until(() => page.evaluate(() => window.__vib.length > 0 && window.__vib[0] > 50), 'vibrate called');
      output.emit('rumble', 1, { large: 0, small: 0 });
      await until(() => page.evaluate(() => window.__vib.includes(0)), 'vibrate stopped');
    });

    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log(`\nAll ${results.length} end-to-end checks passed.`);
  } finally {
    await browser.close();
    await bridge.close();
  }
}

main().catch((err) => { console.error('\nFAILED:', err.stack || err); process.exit(1); });
