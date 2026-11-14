// Layout editor: drag controls to move them, drag the corner handle to resize,
// tap a control to edit it. Also manages screens, motion settings and sharing.
import { TYPES, COMMON_FIELDS, GYRO_FIELDS, bindOptions, makeControl, newId, normalizeLayout } from './schema.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};
const snap = (v, step = 0.5) => Math.round(v / step) * step;
const slug = (s) => (s || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layout';

export class Editor {
  constructor({ stage, engine, panel, onSave, onDelete, onClose, toast }) {
    Object.assign(this, { stage, engine, panel, onSave, onDelete, onClose, toast });
    this.draft = null;
    this.sel = null;
    this.tab = 'control';
    this.dirty = false;
    this.drag = null;
    this.addTo = 'screen';
    this._down = (e) => this._pointerDown(e);
    this._move = (e) => this._pointerMove(e);
    this._up = () => this._pointerUp();
  }

  get open() { return !!this.draft; }

  start(layout, screenId) {
    this.draft = normalizeLayout(layout);
    this.original = JSON.stringify(this.draft);
    this.dirty = false;
    this.sel = null;
    this.engine.releaseAll();
    this.engine.editing = true;
    this.engine.setLayout(this.draft, screenId);
    this.stage.classList.add('editing');
    this.stage.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    this.panel.hidden = false;
    this.renderPanel();
  }

  stop() {
    this.stage.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.stage.classList.remove('editing');
    this.engine.editing = false;
    this.panel.hidden = true;
    const d = this.draft;
    this.draft = null;
    return d;
  }

  _changed(rerender = true) {
    this.dirty = JSON.stringify(this.draft) !== this.original;
    if (rerender) {
      this.engine.setLayout(this.draft, this.engine.screenId);
      this._markSelected();
    } else {
      this.engine.place();
    }
    const s = this.panel.querySelector('.save');
    if (s) s.disabled = !this.dirty;
  }

  // ------------------------------------------------------------ selection / drag

  _find(id) {
    const common = this.draft.common.find((c) => c.id === id);
    if (common) return { def: common, list: this.draft.common, layer: 'common' };
    const list = this.engine.screen.controls;
    const def = list.find((c) => c.id === id);
    return def ? { def, list, layer: 'screen' } : null;
  }

  _markSelected() {
    for (const el of this.stage.querySelectorAll('.ctl.selected')) el.classList.remove('selected');
    for (const el of this.stage.querySelectorAll('.handle')) el.remove();
    if (!this.sel) return;
    const c = this.engine.byId.get(this.sel);
    if (!c) { this.sel = null; return; }
    c.el.classList.add('selected');
    c.el.append(h('div', { class: 'handle' }));
  }

  select(id) {
    this.sel = id;
    this.tab = 'control';
    this._markSelected();
    // Keep the panel on the opposite side from the control being edited.
    const f = id && this._find(id);
    if (f && f.def.x > 55) this.panel.classList.add('left');
    else if (f && f.def.x < 45) this.panel.classList.remove('left');
    this.renderPanel();
  }

  _pointerDown(e) {
    const node = e.target.closest('[data-cid]');
    if (!node || !this.stage.contains(node)) { this.select(null); return; }
    e.preventDefault();
    const id = node.dataset.cid;
    if (id !== this.sel) this.select(id);
    const f = this._find(id);
    if (!f) return;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    this.drag = {
      mode: e.target.classList.contains('handle') ? 'resize' : 'move',
      sx: e.clientX, sy: e.clientY, def: f.def, x: f.def.x, y: f.def.y, s: f.def.s, a: f.def.a || 1, W, H, moved: false,
    };
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.mode === 'move') {
      d.def.x = Math.min(100, Math.max(0, snap(d.x + (dx / d.W) * 100)));
      d.def.y = Math.min(100, Math.max(0, snap(d.y + (dy / d.H) * 100)));
    } else {
      // Corner handle: vertical drag sets size, horizontal sets width ratio.
      const hpx = Math.max(12, (d.s / 100) * d.H + dy * 2);
      const wpx = Math.max(12, (d.s / 100) * d.H * d.a + dx * 2);
      d.def.s = Math.min(100, snap((hpx / d.H) * 100));
      d.def.a = Math.min(6, Math.max(0.2, Math.round((wpx / hpx) * 20) / 20));
    }
    this._changed(false);
  }

  _pointerUp() {
    if (this.drag && this.drag.moved) this.renderPanel();
    this.drag = null;
  }

  // ------------------------------------------------------------ panel

  renderPanel() {
    const tabs = [['control', 'Control'], ['screens', 'Screens'], ['motion', 'Motion'], ['layout', 'Layout']];
    this.panel.replaceChildren(
      h('div', { class: 'ed-head' },
        h('button', { class: 'collapse', title: 'Hide / show panel', onclick: () => this.panel.classList.toggle('collapsed') }, '▤'),
        h('button', { class: 'swap-side', title: 'Move panel to the other side', onclick: () => this.panel.classList.toggle('left') }, '⇆'),
        h('strong', {}, 'Edit layout'),
        h('button', { class: 'save primary', disabled: !this.dirty, onclick: () => this.save() }, 'Save'),
        h('button', { onclick: () => this.close() }, 'Done')),
      h('div', { class: 'ed-tabs' }, tabs.map(([k, l]) => h('button', { class: this.tab === k ? 'on' : '', onclick: () => { this.tab = k; this.renderPanel(); } }, l))),
      h('div', { class: 'ed-body' }, this['_tab_' + this.tab]()),
    );
  }

  _field(f, obj, { rerender = true, layout } = {}) {
    const id = 'f-' + Math.random().toString(36).slice(2);
    const set = (v) => { obj[f.key] = v; this._changed(rerender); };
    let input;
    if (f.type === 'check') {
      input = h('input', { id, type: 'checkbox', checked: !!obj[f.key], onchange: (e) => set(e.target.checked) });
      return h('label', { class: 'row check', for: id }, input, h('span', {}, f.label));
    }
    if (f.type === 'range') {
      const out = h('output', {}, String(obj[f.key] ?? ''));
      input = h('input', { id, type: 'range', min: f.min, max: f.max, step: f.step, value: obj[f.key] ?? f.min,
        oninput: (e) => { out.textContent = e.target.value; obj[f.key] = +e.target.value; this._changed(false); },
        onchange: () => this._changed(rerender) });
      return h('label', { class: 'row', for: id }, h('span', {}, f.label), h('div', { class: 'range' }, input, out));
    }
    if (f.type === 'select' || f.type === 'bind') {
      const groups = f.type === 'bind' ? bindOptions(layout || this.draft) : [{ label: null, options: f.options }];
      input = h('select', { id, onchange: (e) => set(e.target.value || undefined) },
        f.optional ? h('option', { value: '' }, '(none)') : null,
        groups.map((g) => {
          const opts = g.options.map(([v, l]) => h('option', { value: v, selected: obj[f.key] === v }, l));
          return g.label ? h('optgroup', { label: g.label }, opts) : opts;
        }));
      return h('label', { class: 'row', for: id }, h('span', {}, f.label), input);
    }
    input = h('input', { id, type: 'text', value: obj[f.key] ?? '', onchange: (e) => set(e.target.value) });
    return h('label', { class: 'row', for: id }, h('span', {}, f.label), input);
  }

  _tab_control() {
    const f = this.sel && this._find(this.sel);
    const add = h('div', { class: 'section' },
      h('h4', {}, 'Add a control'),
      h('div', { class: 'seg' },
        ['screen', 'common'].map((k) => h('button', { class: this.addTo === k ? 'on' : '', onclick: () => { this.addTo = k; this.renderPanel(); } },
          k === 'screen' ? `This screen (${this.engine.screen.name})` : 'Every screen'))),
      h('div', { class: 'grid' }, Object.entries(TYPES).map(([type, t]) => h('button', { onclick: () => this.addControl(type) }, '+ ' + t.label))));
    if (!f) return [h('p', { class: 'hint' }, 'Tap a control on the left to change it. Drag to move it; drag its corner to resize.'), add];
    const t = TYPES[f.def.type];
    return [
      h('div', { class: 'section' },
        h('h4', {}, `${t.label} ${f.layer === 'common' ? '· on every screen' : '· this screen only'}`),
        t.fields.map((fd) => this._field(fd, f.def)),
        COMMON_FIELDS.map((fd) => this._field(fd, f.def, { rerender: false })),
        h('div', { class: 'grid' },
          h('button', { onclick: () => this.duplicate(f) }, 'Duplicate'),
          h('button', { onclick: () => this.moveLayer(f) }, f.layer === 'common' ? 'Only this screen' : 'Show on every screen'),
          h('button', { class: 'danger', onclick: () => this.remove(f) }, 'Delete'))),
      add,
    ];
  }

  addControl(type) {
    const def = makeControl(type);
    (this.addTo === 'common' ? this.draft.common : this.engine.screen.controls).push(def);
    this._changed();
    this.select(def.id);
  }

  duplicate(f) {
    const def = { ...structuredClone(f.def), id: newId(), x: Math.min(100, f.def.x + 4), y: Math.min(100, f.def.y + 4) };
    f.list.push(def);
    this._changed();
    this.select(def.id);
  }

  moveLayer(f) {
    f.list.splice(f.list.indexOf(f.def), 1);
    (f.layer === 'common' ? this.engine.screen.controls : this.draft.common).push(f.def);
    this._changed();
    this.select(f.def.id);
  }

  remove(f) {
    f.list.splice(f.list.indexOf(f.def), 1);
    this.sel = null;
    this._changed();
    this.renderPanel();
  }

  _tab_screens() {
    const list = this.draft.screens;
    const go = (id) => { this.sel = null; this.engine.setScreen(id); this._markSelected(); this.renderPanel(); };
    return [
      h('p', { class: 'hint' }, 'Screens are pages of controls you can swap instantly: with the tabs at the top, a “Go to” button, or a “Show while held” button (like a shift key). Controls set to “every screen” stay put when you swap.'),
      list.map((s, i) => h('div', { class: 'section screen-item' + (s.id === this.engine.screenId ? ' current' : '') },
        h('div', { class: 'row inline' },
          h('input', { type: 'text', value: s.name, onchange: (e) => { s.name = e.target.value || 'Screen'; this._changed(); this.renderPanel(); } }),
          h('button', { onclick: () => go(s.id), disabled: s.id === this.engine.screenId }, s.id === this.engine.screenId ? 'Editing' : 'Edit')),
        this._field({ key: 'gyro', type: 'check', label: 'Allow motion controls on this screen' }, new Proxy(s, {
          get: (o, k) => (k === 'gyro' ? o.gyro !== false : o[k]),
          set: (o, k, v) => { o[k] = v ? undefined : false; if (o[k] === undefined) delete o[k]; return true; },
        })),
        this._field({ key: 'hideCommon', type: 'check', label: 'Hide “every screen” controls here' }, s),
        h('div', { class: 'grid' },
          h('button', { disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); this._changed(); this.renderPanel(); } }, '↑ Move up'),
          h('button', { onclick: () => {
            const copy = structuredClone(s);
            copy.id = newId('s'); copy.name = s.name + ' copy';
            copy.controls.forEach((c) => { c.id = newId(); });
            list.splice(i + 1, 0, copy); this._changed(); this.renderPanel();
          } }, 'Duplicate'),
          h('button', { class: 'danger', disabled: list.length === 1, onclick: () => {
            list.splice(i, 1);
            if (s.id === this.engine.screenId) this.engine.screenId = list[0].id;
            this._changed(); this.renderPanel();
          } }, 'Delete')))),
      h('button', { class: 'wide', onclick: () => {
        const s = { id: newId('s'), name: 'Screen ' + (list.length + 1), controls: [] };
        list.push(s); this._changed(); go(s.id);
      } }, '+ Add screen'),
    ];
  }

  _tab_motion() {
    return [
      h('p', { class: 'hint' }, 'Aim or steer by moving the phone. Add a button with a Gyro action for “hold to aim” or ratcheting (lift to re-centre). On Windows with the DS4 output, “Raw gyro to DS4” lets Steam Input handle the motion instead.'),
      h('div', { class: 'section' }, GYRO_FIELDS.map((f) => this._field(f, this.draft.gyro, { rerender: false }))),
    ];
  }

  _tab_layout() {
    const d = this.draft;
    const matchObj = { get match() { return d.match.join(', '); }, set match(v) { d.match = v.split(',').map((s) => s.trim()).filter(Boolean); } };
    const io = h('textarea', { class: 'io', rows: 6, placeholder: 'Paste a shared layout here, or press Export…', spellcheck: 'false' });
    return [
      h('div', { class: 'section' },
        this._field({ key: 'name', type: 'text', label: 'Layout name' }, d),
        this._field({ key: 'match', type: 'text', label: 'Switch to this layout automatically when these programs are focused (e.g. eldenring.exe)' }, matchObj),
        this._field({ key: 'haptics', type: 'check', label: 'Vibrate on press' }, d.settings),
        this._field({ key: 'slide', type: 'check', label: 'Slide between buttons without lifting' }, d.settings),
        this._field({ key: 'showTabs', type: 'check', label: 'Show screen tabs at the top' }, d.settings)),
      h('div', { class: 'section' },
        h('h4', {}, 'Share'),
        io,
        h('div', { class: 'grid' },
          h('button', { onclick: () => { io.value = JSON.stringify(d, null, 2); io.select(); } }, 'Export'),
          h('button', { onclick: async () => { io.value = JSON.stringify(d, null, 2); try { await navigator.clipboard.writeText(io.value); this.toast('Copied'); } catch { io.select(); } } }, 'Copy'),
          h('button', { onclick: () => {
            const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: d.id + '.padforge.json' });
            a.click();
          } }, 'Download'),
          h('button', { onclick: () => this.importText(io.value) }, 'Import pasted'),
          h('label', { class: 'button' }, 'Import file', h('input', { type: 'file', accept: '.json,application/json', hidden: true,
            onchange: async (e) => { const file = e.target.files[0]; if (file) this.importText(await file.text()); } })))),
      h('div', { class: 'section' },
        h('h4', {}, 'Layout'),
        h('div', { class: 'grid' },
          h('button', { onclick: () => this.saveAsNew() }, 'Save as new layout'),
          h('button', { class: 'danger', onclick: () => this.deleteLayout() }, 'Delete / reset layout'))),
    ];
  }

  importText(text) {
    let l;
    try { l = JSON.parse(text); } catch { this.toast('That isn’t valid layout JSON'); return; }
    if (!l || !Array.isArray(l.screens) || !l.screens.length) { this.toast('Not a PadForge layout'); return; }
    l.id = slug(l.name) + '-' + Math.random().toString(36).slice(2, 6);
    this.draft = normalizeLayout(l);
    this.original = '';
    this.sel = null;
    this._changed();
    this.renderPanel();
    this.toast('Imported. Press Save to keep it.');
  }

  async saveAsNew() {
    const name = prompt('Name for the new layout', this.draft.name + ' (copy)');
    if (!name) return;
    this.draft.name = name;
    this.draft.id = slug(name) + '-' + Math.random().toString(36).slice(2, 6);
    this.original = '';
    await this.save();
  }

  async deleteLayout() {
    if (!confirm(`Delete “${this.draft.name}”? Built-in layouts go back to their original version.`)) return;
    const id = this.draft.id;
    this.stop();
    await this.onDelete(id);
  }

  async save() {
    try {
      await this.onSave(this.draft);
      this.original = JSON.stringify(this.draft);
      this.dirty = false;
      this.toast('Saved');
      this.renderPanel();
    } catch (err) {
      this.toast('Could not save: ' + err.message);
    }
  }

  close() {
    if (this.dirty && !confirm('Discard unsaved changes?')) return;
    const screenId = this.engine.screenId;
    this.stop();
    this.onClose(screenId);
  }
}
