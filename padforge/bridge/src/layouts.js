'use strict';
// Layout storage. Built-in layouts ship in bridge/layouts; user layouts live in
// ~/.padforge/layouts and override built-ins with the same id.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BUILTIN_DIR = path.join(__dirname, '..', 'layouts');
const CONTROL_TYPES = new Set(['button', 'stick', 'dpad', 'trigger', 'touchpad', 'label']);
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BYTES = 256 * 1024;

function validate(layout) {
  const errs = [];
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObj(layout)) return ['layout must be an object'];
  if (!ID_RE.test(layout.id || '')) errs.push('id must be lowercase letters, digits, - or _ (max 64)');
  if (typeof layout.name !== 'string' || !layout.name || layout.name.length > 80) errs.push('name must be 1-80 characters');
  if (layout.match !== undefined && (!Array.isArray(layout.match) || layout.match.some((m) => typeof m !== 'string')))
    errs.push('match must be a list of program names');
  const checkControls = (list, where) => {
    if (!Array.isArray(list)) { errs.push(`${where} must be a list`); return; }
    if (list.length > 64) errs.push(`${where} has more than 64 controls`);
    list.forEach((c, i) => {
      if (!isObj(c)) { errs.push(`${where}[${i}] must be an object`); return; }
      if (!CONTROL_TYPES.has(c.type)) errs.push(`${where}[${i}] has unknown type ${c.type}`);
      for (const k of ['x', 'y', 's']) if (!Number.isFinite(c[k])) errs.push(`${where}[${i}].${k} must be a number`);
    });
  };
  if (layout.common !== undefined) checkControls(layout.common, 'common');
  if (!Array.isArray(layout.screens) || layout.screens.length < 1 || layout.screens.length > 20) {
    errs.push('screens must have 1-20 entries');
  } else {
    const ids = new Set();
    layout.screens.forEach((s, i) => {
      if (!isObj(s)) { errs.push(`screens[${i}] must be an object`); return; }
      if (!ID_RE.test(s.id || '')) errs.push(`screens[${i}].id is invalid`);
      if (ids.has(s.id)) errs.push(`duplicate screen id ${s.id}`);
      ids.add(s.id);
      checkControls(s.controls, `screens[${i}].controls`);
    });
  }
  if (Buffer.byteLength(JSON.stringify(layout)) > MAX_BYTES) errs.push('layout is larger than 256 KB');
  return errs;
}

class LayoutStore {
  constructor(userDir = path.join(os.homedir(), '.padforge', 'layouts')) {
    this.userDir = userDir;
    fs.mkdirSync(userDir, { recursive: true });
  }

  _read(dir) {
    const out = new Map();
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
    for (const f of files) {
      try {
        const l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (validate(l).length === 0) out.set(l.id, l);
        else console.warn(`[layouts] skipping invalid ${f}:`, validate(l).join('; '));
      } catch (err) {
        console.warn(`[layouts] could not read ${f}:`, err.message);
      }
    }
    return out;
  }

  all() {
    const builtin = this._read(BUILTIN_DIR);
    const user = this._read(this.userDir);
    const merged = new Map();
    for (const [id, l] of builtin) merged.set(id, { layout: l, builtin: true, modified: false });
    for (const [id, l] of user) merged.set(id, { layout: l, builtin: builtin.has(id), modified: builtin.has(id) });
    return merged;
  }

  list() {
    return [...this.all().values()].map(({ layout, builtin, modified }) => ({
      id: layout.id, name: layout.name, match: layout.match || [], builtin, modified,
    }));
  }

  get(id) {
    const e = this.all().get(id);
    return e ? e.layout : null;
  }

  save(layout) {
    const errs = validate(layout);
    if (errs.length) throw new Error(errs.join('; '));
    fs.writeFileSync(path.join(this.userDir, layout.id + '.json'), JSON.stringify(layout, null, 2));
  }

  // Deleting a modified built-in reverts it to the shipped version.
  delete(id) {
    if (!ID_RE.test(id)) throw new Error('invalid id');
    const f = path.join(this.userDir, id + '.json');
    if (!fs.existsSync(f)) throw new Error('built-in layouts cannot be deleted');
    fs.unlinkSync(f);
  }

  forProgram(exe) {
    if (!exe) return null;
    const name = exe.toLowerCase();
    for (const { layout } of this.all().values()) {
      if ((layout.match || []).some((m) => m.toLowerCase() === name)) return layout.id;
    }
    return null;
  }
}

module.exports = { LayoutStore, validate };
