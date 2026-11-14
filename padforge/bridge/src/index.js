#!/usr/bin/env node
'use strict';
// PadForge bridge CLI.
//   node src/index.js [--output auto|x360|ds4|uinput|log] [--port 8080] [--https-port 8443]
//                     [--token CODE] [--no-https] [--verbose]
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Bridge } = require('./server');
const { createOutput } = require('./outputs');

function parseArgs(argv) {
  const a = { output: 'auto', port: 8080, httpsPort: 8443, https: true, verbose: false, token: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--output') a.output = next();
    else if (k === '--port') a.port = +next();
    else if (k === '--https-port') a.httpsPort = +next();
    else if (k === '--no-https') a.https = false;
    else if (k === '--token') a.token = next();
    else if (k === '--verbose' || k === '-v') a.verbose = true;
    else if (k === '--help' || k === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 5).join('\n').replace(/\/\/ ?/g, ''));
      process.exit(0);
    }
  }
  return a;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

// The pairing code is kept between runs so phones don't need to re-pair.
function loadToken(given) {
  const dir = path.join(os.homedir(), '.padforge');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'token');
  if (given) { fs.writeFileSync(f, given); return given; }
  try { return fs.readFileSync(f, 'utf8').trim(); } catch { /* make one */ }
  const t = String(crypto.randomInt(100000, 1000000));
  fs.writeFileSync(f, t);
  return t;
}

// iOS only gives web pages motion sensors over HTTPS, so we serve a
// self-signed certificate too. The phone must accept the warning once.
function loadTls() {
  const dir = path.join(os.homedir(), '.padforge');
  const keyF = path.join(dir, 'tls-key.pem');
  const certF = path.join(dir, 'tls-cert.pem');
  try { return { key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) }; } catch { /* generate */ }
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'padforge.local' }], { days: 3650, keySize: 2048 });
  fs.writeFileSync(keyF, pems.private);
  fs.writeFileSync(certF, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = loadToken(args.token);
  const output = createOutput(args.output, { verbose: args.verbose });
  const bridge = new Bridge({ output, token, log: console.log });
  let tls = null;
  if (args.https) {
    try { tls = loadTls(); } catch (err) { console.warn('[bridge] HTTPS disabled:', err.message); }
  }
  await bridge.listen({ port: args.port, httpsPort: tls ? args.httpsPort : 0, tls });

  const d = output.describe();
  console.log(`\nPadForge bridge running. Output: ${d.controller}${d.kbm ? ' + keyboard/mouse' : ''}`);
  console.log(`Pairing code: ${token}\n`);
  const ips = lanAddresses();
  const urls = ips.map((ip) => (tls ? `https://${ip}:${args.httpsPort}` : `http://${ip}:${args.port}`) + `/#k=${token}`);
  for (const u of urls) console.log('  Open on your phone:', u);
  if (tls) console.log('  (No gyro needed? Plain HTTP also works:', ips.map((ip) => `http://${ip}:${args.port}`).join(', ') + ')');
  if (urls[0]) {
    try { require('qrcode-terminal').generate(urls[0], { small: true }); } catch { /* optional */ }
  }

  const stop = () => { console.log('\nStopping…'); bridge.close().then(() => { output.close(); process.exit(0); }); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error(err); process.exit(1); });
