'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { Bridge } = require('../src/server');
const { MemoryOutput } = require('../src/outputs/memory');
const { LayoutStore, validate } = require('../src/layouts');
const pad = require('../src/pad');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padforge-test-'));
  const output = new MemoryOutput();
  const bridge = new Bridge({ output, token: '111111', layouts: new LayoutStore(dir), foreground: false, log: () => {} });
  const [port] = await bridge.listen({ port: 0, host: '127.0.0.1' });
  const connect = (token = '111111', clientId = 'phone-1') => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token, clientId, name: 'test' })));
    ws.on('error', reject);
    ws.msgs = msgs;
    ws.next = async (t) => {
      for (let i = 0; i < 100; i++) {
        const idx = msgs.findIndex((m) => m.t === t);
        if (idx >= 0) return msgs.splice(idx, 1)[0];
        await sleep(10);
      }
      throw new Error('no ' + t);
    };
    ws.on('close', (code) => { ws.closedWith = code; });
    setTimeout(() => resolve(ws), 50);
  });
  return { bridge, output, port, connect, dir, close: () => bridge.close() };
}

test('sanitize clamps and filters untrusted input', () => {
  const s = pad.sanitize({ b: ['A', 'HACK', 'UP'], lx: 5, ly: -9, rx: 'x', lt: 2, rt: -1, g: { p: 99999, y: 1, r: 2 } });
  assert.deepStrictEqual([...s.buttons], ['A', 'UP']);
  assert.strictEqual(s.lx, 1);
  assert.strictEqual(s.ly, -1);
  assert.strictEqual(s.rx, 0);
  assert.strictEqual(s.lt, 1);
  assert.strictEqual(s.rt, 0);
  assert.strictEqual(s.gyro.pitch, 2000);
});

test('built-in layouts are valid', () => {
  const dir = path.join(__dirname, '..', 'layouts');
  for (const f of fs.readdirSync(dir)) {
    assert.deepStrictEqual(validate(JSON.parse(fs.readFileSync(path.join(dir, f)))), [], f);
  }
  assert.ok(validate({ id: 'Bad Id', name: '', screens: [] }).length >= 3);
});

test('wrong pairing code is rejected', async () => {
  const t = await setup();
  const ws = await t.connect('000000');
  const err = await ws.next('error');
  assert.strictEqual(err.code, 'auth');
  await sleep(50);
  assert.strictEqual(ws.closedWith, 4003);
  assert.strictEqual(t.output.pads.size, 0);
  await t.close();
});

test('pad state, keys and mouse reach the output', async () => {
  const t = await setup();
  const ws = await t.connect();
  const welcome = await ws.next('welcome');
  assert.strictEqual(welcome.player, 1);
  assert.ok(welcome.layouts.some((l) => l.id === 'standard'));
  ws.send(JSON.stringify({ t: 'pad', b: ['A'], lx: 0.5, ly: 0, rx: 0, ry: 0, lt: 0, rt: 1, k: ['KeyW', 'Nope'], m: ['left'] }));
  ws.send(JSON.stringify({ t: 'mouse', dx: 5, dy: -3 }));
  await sleep(50);
  const s = t.output.pads.get(1);
  assert.ok(s.buttons.has('A'));
  assert.strictEqual(s.lx, 0.5);
  assert.strictEqual(s.rt, 1);
  assert.deepStrictEqual(t.output.events.filter((e) => e.type !== 'mouse'), [
    { type: 'key', code: 'KeyW', down: true }, { type: 'mbtn', button: 'left', down: true },
  ]);
  assert.ok(t.output.events.some((e) => e.type === 'mouse' && e.dx === 5));
  // Releasing is just sending state without the key.
  ws.send(JSON.stringify({ t: 'pad', b: [], k: [], m: [] }));
  await sleep(50);
  assert.ok(t.output.events.some((e) => e.type === 'key' && e.code === 'KeyW' && !e.down));
  ws.close();
  await t.close();
});

test('two phones get separate pads and shared keys are ref-counted', async () => {
  const t = await setup();
  const a = await t.connect('111111', 'a');
  const b = await t.connect('111111', 'b');
  assert.strictEqual((await a.next('welcome')).player, 1);
  assert.strictEqual((await b.next('welcome')).player, 2);
  a.send(JSON.stringify({ t: 'pad', b: ['A'], k: ['Space'] }));
  b.send(JSON.stringify({ t: 'pad', b: ['B'], k: ['Space'] }));
  await sleep(50);
  assert.ok(t.output.pads.get(1).buttons.has('A'));
  assert.ok(t.output.pads.get(2).buttons.has('B'));
  a.send(JSON.stringify({ t: 'pad', b: [], k: [] }));
  await sleep(50);
  const spaceUps = t.output.events.filter((e) => e.code === 'Space' && !e.down);
  assert.strictEqual(spaceUps.length, 0, 'Space must stay down while phone b holds it');
  a.close(); b.close();
  await t.close();
});

test('inputs are released when a phone goes quiet, and restored when it resumes', async () => {
  const t = await setup();
  const ws = await t.connect();
  await ws.next('welcome');
  ws.send(JSON.stringify({ t: 'pad', b: ['X'], k: ['KeyD'] }));
  await sleep(1400);
  assert.strictEqual(t.output.pads.get(1).buttons.size, 0);
  assert.ok(t.output.events.some((e) => e.code === 'KeyD' && !e.down));
  ws.send(JSON.stringify({ t: 'pad', b: ['X'], k: ['KeyD'] }));
  await sleep(50);
  assert.ok(t.output.pads.get(1).buttons.has('X'));
  assert.strictEqual(t.output.events.filter((e) => e.code === 'KeyD' && e.down).length, 2);
  ws.close();
  await t.close();
});

test('reconnecting keeps the same player slot', async () => {
  const t = await setup();
  const ws = await t.connect('111111', 'same');
  assert.strictEqual((await ws.next('welcome')).player, 1);
  ws.close();
  await sleep(50);
  const ws2 = await t.connect('111111', 'same');
  assert.strictEqual((await ws2.next('welcome')).player, 1);
  assert.strictEqual(t.output.pads.size, 1);
  ws2.close();
  await t.close();
});

test('layouts can be saved, listed, fetched and deleted', async () => {
  const t = await setup();
  const ws = await t.connect();
  await ws.next('welcome');
  const layout = { id: 'my-game', name: 'My game', match: ['mygame.exe'], screens: [{ id: 'main', name: 'Main', controls: [{ id: 'c1', type: 'button', x: 50, y: 50, s: 10, bind: 'A' }] }] };
  ws.send(JSON.stringify({ t: 'layout.save', layout, req: 1 }));
  assert.strictEqual((await ws.next('layout.saved')).id, 'my-game');
  const list = await ws.next('layout.list');
  assert.ok(list.layouts.some((l) => l.id === 'my-game' && !l.builtin));
  assert.strictEqual(t.bridge.layouts.forProgram('MyGame.exe'), 'my-game');
  ws.send(JSON.stringify({ t: 'layout.get', id: 'my-game', req: 2 }));
  assert.strictEqual((await ws.next('layout')).layout.name, 'My game');
  ws.send(JSON.stringify({ t: 'layout.save', layout: { ...layout, id: '../evil' }, req: 3 }));
  assert.strictEqual((await ws.next('error')).code, 'bad-request');
  ws.send(JSON.stringify({ t: 'layout.delete', id: 'my-game', req: 4 }));
  await ws.next('layout.deleted');
  assert.strictEqual(t.bridge.layouts.get('my-game'), null);
  ws.close();
  await t.close();
});

test('static server serves the app and blocks path traversal', async () => {
  const t = await setup();
  const ok = await fetch(`http://127.0.0.1:${t.port}/`);
  assert.strictEqual(ok.status, 200);
  assert.match(await ok.text(), /PadForge/);
  const bad = await fetch(`http://127.0.0.1:${t.port}/..%2f..%2fbridge%2fpackage.json`);
  assert.ok(bad.status === 403 || bad.status === 404);
  await t.close();
});
