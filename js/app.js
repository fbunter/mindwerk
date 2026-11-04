// Mindwerk – Editor-Oberfläche: Canvas, Interaktion, Panel, Gliederung, Präsentation.
import * as S from './store.js';
import { computeLayout, edgePath, relationPath, STRUCTURES, STRUCT_ICONS } from './layout.js';
import * as IO from './io.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = IO.esc;
const canvas = $('#canvas'), world = $('#world'), nodesEl = $('#nodes'), linesEl = $('#lines'), relEl = $('#relations');
const outlineEl = $('#outline'), panelEl = $('#panel-body');
const els = new Map();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const state = {
  doc: null, sel: null, selRel: null, editing: null, mode: 'map',
  history: [], future: [], olSnap: null,
  view: { x: 0, y: 0, scale: 1 }, layout: null, meta: new Map(),
  relMode: null, search: { hits: [], i: -1 }, present: null, clip: null, ctx: null,
};

const find = id => S.find(state.doc.root, id);
const parentOf = id => S.parentOf(state.doc.root, id);
const theme = () => S.THEMES[state.doc.theme] || S.THEMES.klassisch;
const isMap = () => state.mode === 'map';
const isRoot = id => id === state.doc.root.id;

// ---------- Icons ----------
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  child: 'M4 5h7v5H4zM13 15h7v5h-7zM7.5 10v7.5H13',
  sibling: 'M4 4h8v5H4zM4 15h8v5H4zM16 17.5h5M18.5 15v5',
  relation: 'M5 19C5 11 11 5 19 5M15 2.5 19 5l-2.5 4',
  outline: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  present: 'M3 4h18v12H3zM10 8l5 2.5-5 2.5zM12 16v4M8 20h8',
  import: 'M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  export: 'M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  panel: 'M4 4h16v16H4zM15 4v16',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5 16 16',
  up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', left: 'm15 6-6 6 6 6', right: 'm9 6 6 6-6 6',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
function injectIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (!el.querySelector(':scope > svg')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

// ---------- Helfer ----------
function contrast(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  if (v.some(Number.isNaN)) return '#ffffff';
  const [r, g, b] = v.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.06) ? '#ffffff' : '#1b1d24';
}
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const inField = t => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
const countDesc = n => { let c = 0; S.walk(n, () => { c++; }); return c - 1; };

// ---------- Verlauf ----------
const snapshot = () => JSON.stringify(state.doc);
function pushHistory(snap) {
  state.history.push(snap);
  if (state.history.length > 150) state.history.shift();
  state.future.length = 0;
}
function flushOutlineSnap() {
  if (!state.olSnap) return;
  if (snapshot() !== state.olSnap) pushHistory(state.olSnap);
  state.olSnap = null;
}
function commit(fn) {
  flushOutlineSnap();
  pushHistory(snapshot());
  fn(state.doc);
  persist();
  render();
}
function restore(snap) {
  state.doc = JSON.parse(snap);
  if (!find(state.sel)) state.sel = state.doc.root.id;
  state.selRel = null;
  persist();
  render();
}
function undo() {
  finishEdit();
  flushOutlineSnap();
  if (!state.history.length) return toast('Nichts rückgängig zu machen');
  state.future.push(snapshot());
  const f = state.future.slice();
  restore(state.history.pop());
  state.future = f;
  updateUndoButtons();
}
function redo() {
  finishEdit();
  if (!state.future.length) return;
  state.history.push(snapshot());
  const f = state.future.slice();
  const snap = f.pop();
  restore(snap);
  state.future = f;
  updateUndoButtons();
}
function persist() {
  S.storage.save(state.doc);
  renderSidebar();
  updateUndoButtons();
}
let persistTimer;
function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); }
function updateUndoButtons() {
  $('#btn-undo').disabled = !state.history.length && !state.olSnap;
  $('#btn-redo').disabled = !state.future.length;
}

// ---------- Dokument öffnen ----------
function openDoc(doc, { fit = true } = {}) {
  finishEdit();
  flushOutlineSnap();
  if (state.present) stopPresent();
  state.doc = doc;
  state.sel = doc.root.id;
  state.selRel = null;
  state.history = [];
  state.future = [];
  state.search = { hits: [], i: -1 };
  for (const el of els.values()) el.remove();
  els.clear();
  S.storage.setLast(doc.id);
  render();
  if (fit && isMap()) fitView(false);
  if (!isMap()) focusRow(doc.root.id);
}

// ---------- Rendering ----------
function render() {
  if (!state.doc) return;
  const th = theme();
  canvas.style.setProperty('--bg', th.bg);
  canvas.style.setProperty('--dot', th.dot);
  canvas.style.setProperty('--text', th.text);
  canvas.style.setProperty('--rel', th.rel);
  const title = $('#doc-title');
  if (document.activeElement !== title) title.value = state.doc.title;
  document.title = `${state.doc.title} – Mindwerk`;
  if (isMap()) renderCanvas(); else renderOutline();
  renderPanel();
  renderSidebar();
  updateUndoButtons();
}

function renderCanvas() {
  const th = theme();
  const seen = new Set();
  state.meta = new Map();
  const visit = (n, depth, color) => {
    seen.add(n.id);
    const own = depth === 0 ? (n.color || th.rootBg) : (n.color || color);
    upsertTopic(n, depth, own, th);
    if (n.collapsed) return;
    n.children.forEach((c, i) => visit(c, depth + 1, depth === 0 ? th.palette[i % th.palette.length] : own));
  };
  visit(state.doc.root, 0, null);
  for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
  layoutPass();
}

function markerHTML(m) {
  if (/^p\d$/.test(m)) { const i = +m.slice(1); return `<span class="mk mk-p" style="--mk:${S.PRIORITY_COLORS[i - 1]}">${i}</span>`; }
  if (/^t\d+$/.test(m)) return `<span class="mk mk-t">${pie(+m.slice(1) / 100)}</span>`;
  const e = S.SYMBOLS[m];
  return e ? `<span class="mk mk-e">${e}</span>` : '';
}
function pie(f) {
  let inner = '';
  if (f >= 1) inner = '<circle cx="8" cy="8" r="7.2" fill="#30a46c"/><path d="M4.8 8.3l2.2 2.2 4.3-4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  else if (f > 0) {
    const a = f * 2 * Math.PI, x = 8 + 7 * Math.sin(a), y = 8 - 7 * Math.cos(a);
    inner = `<path d="M8 8V1A7 7 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z" fill="#0091ff"/>`;
  }
  return `<svg viewBox="0 0 16 16" width="1.15em" height="1.15em"><circle cx="8" cy="8" r="7" fill="#fff" stroke="#0091ff" stroke-width="1.4"/>${inner}</svg>`;
}

function upsertTopic(n, depth, color, th) {
  let fill, fg, border;
  if (depth === 0) { fill = n.color || th.rootBg; fg = n.color ? contrast(n.color) : th.rootFg; border = 'transparent'; }
  else if (depth === 1 || n.color) { fill = color; fg = contrast(color); border = 'transparent'; }
  else { fill = th.subBg; fg = th.text; border = color; }
  state.meta.set(n.id, { depth, color, fill, fg, border });

  let el = els.get(n.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'topic';
    el.dataset.id = n.id;
    el.innerHTML = '<div class="t-main"><span class="t-mk"></span><span class="t-text"></span><span class="t-ic"></span></div><div class="t-lb"></div><button class="t-fold" tabindex="-1"></button>';
    nodesEl.appendChild(el);
    els.set(n.id, el);
  }
  const sig = [n.text, n.markers.join(), n.labels.join('\u0001'), !!n.note, n.link, n.collapsed, n.children.length, depth, fill, fg, border, color].join('\u0002');
  if (el._sig === sig) return;
  el._sig = sig;
  const st = IO.styleFor(depth);
  Object.assign(el.style, {
    fontSize: st.size + 'px', fontWeight: st.weight, lineHeight: st.lh, padding: `${st.py}px ${st.px}px`,
    borderRadius: st.radius + 'px', maxWidth: st.maxW + 'px', background: fill, color: fg, borderColor: border,
  });
  el.style.setProperty('--c', color || fill);
  el.dataset.depth = Math.min(depth, 2);
  if (state.editing !== n.id) el.querySelector('.t-text').textContent = n.text;
  el.querySelector('.t-mk').innerHTML = n.markers.map(markerHTML).join('');
  el.querySelector('.t-ic').innerHTML =
    (n.note ? `<span class="ic" title="${esc(n.note)}">📝</span>` : '') +
    (n.link ? `<a class="ic" href="${esc(n.link)}" target="_blank" rel="noopener" title="${esc(n.link)}">🔗</a>` : '');
  el.querySelector('.t-lb').innerHTML = n.labels.map(l => `<span class="lbl">${esc(l)}</span>`).join('');
  const fold = el.querySelector('.t-fold');
  fold.hidden = depth === 0 || !n.children.length;
  fold.textContent = n.collapsed ? countDesc(n) : '−';
  fold.title = n.collapsed ? 'Ausklappen' : 'Einklappen';
  el.classList.toggle('collapsed', n.collapsed);
}

const edgeWidth = d => (d <= 1 ? 2.6 : d === 2 ? 1.8 : 1.4);
function foldSide(p) {
  const s = state.doc.structure;
  if (s === 'org') return 'b';
  if (s === 'tree' || s === 'timeline') return 'bl';
  return p.dir < 0 ? 'l' : 'r';
}

function layoutPass() {
  const sizes = new Map();
  for (const [id, el] of els) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
  const L = computeLayout(state.doc.root, id => sizes.get(id) || { w: 0, h: 0 }, state.doc.structure);
  state.layout = L;
  for (const [id, p] of L.pos) {
    const el = els.get(id);
    if (!el) continue;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.dataset.side = foldSide(p);
  }
  linesEl.innerHTML = L.edges.map(e => {
    const m = state.meta.get(e.to);
    return `<path data-to="${e.to}" d="${edgePath(e, L.pos)}" stroke="${m?.color || '#999'}" stroke-width="${edgeWidth(e.depth)}"/>`;
  }).join('');
  renderRelations();
  applyHighlights();
}

function renderRelations() {
  const L = state.layout;
  if (!L) return;
  relEl.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' +
    state.doc.relations.map(r => {
      const a = L.pos.get(r.from), b = L.pos.get(r.to);
      if (!a || !b) return '';
      const { d, label } = relationPath(a, b);
      return `<g class="rel${state.selRel === r.id ? ' sel' : ''}" data-rel="${r.id}"><path class="rel-hit" d="${d}"/><path class="rel-line" d="${d}" marker-end="url(#arrow)"/>${r.label ? `<text class="rel-label" x="${label.x}" y="${label.y}">${esc(r.label)}</text>` : ''}</g>`;
    }).join('');
}

function applyHighlights() {
  const hits = new Set(state.search.hits);
  const focus = state.present?.focus;
  for (const [id, el] of els) {
    el.classList.toggle('selected', id === state.sel && !state.present);
    el.classList.toggle('match', hits.has(id));
    el.classList.toggle('dim', !!focus && !focus.has(id));
  }
  linesEl.querySelectorAll('path').forEach(p => p.classList.toggle('dim', !!focus && !focus.has(p.dataset.to)));
  relEl.classList.toggle('dim', !!focus);
}

// ---------- Ansicht (Zoom / Pan) ----------
function applyView(animate = false) {
  const { x, y, scale } = state.view;
  if (animate) {
    world.classList.add('animate');
    clearTimeout(applyView._t);
    applyView._t = setTimeout(() => world.classList.remove('animate'), 480);
  }
  world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  canvas.style.backgroundPosition = `${x}px ${y}px`;
  canvas.style.backgroundSize = `${22 * scale}px ${22 * scale}px`;
  $('#zoom-label').textContent = Math.round(scale * 100) + '%';
}
function fitBounds(b, animate = false, maxScale = 1) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H || !b || !isFinite(b.minX)) return;
  const pad = 60;
  const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
  const s = Math.max(0.15, Math.min(maxScale, (W - pad * 2) / bw, (H - pad * 2) / bh));
  state.view = { scale: s, x: W / 2 - (b.minX + bw / 2) * s, y: H / 2 - (b.minY + bh / 2) * s };
  applyView(animate);
}
const fitView = (animate = true) => fitBounds(state.layout?.bounds, animate);
function zoomAt(cx, cy, f, animate = false) {
  const r = canvas.getBoundingClientRect();
  const px = cx - r.left, py = cy - r.top;
  const s0 = state.view.scale, s1 = Math.min(3, Math.max(0.15, s0 * f));
  state.view.x = px - (px - state.view.x) * (s1 / s0);
  state.view.y = py - (py - state.view.y) * (s1 / s0);
  state.view.scale = s1;
  applyView(animate);
}
function zoomBy(f) { const r = canvas.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f, true); }
function centerOn(id, animate = true) {
  const p = state.layout?.pos.get(id);
  if (!p) return;
  const s = state.view.scale;
  state.view.x = canvas.clientWidth / 2 - (p.x + p.w / 2) * s;
  state.view.y = canvas.clientHeight / 2 - (p.y + p.h / 2) * s;
  applyView(animate);
}
function ensureVisible(id) {
  const p = state.layout?.pos.get(id);
  if (!p) return;
  const { scale, x, y } = state.view;
  const W = canvas.clientWidth, H = canvas.clientHeight, m = 40;
  const sx = p.x * scale + x, sy = p.y * scale + y, sw = p.w * scale, sh = p.h * scale;
  let dx = 0, dy = 0;
  if (sx < m) dx = m - sx; else if (sx + sw > W - m) dx = W - m - (sx + sw);
  if (sy < m) dy = m - sy; else if (sy + sh > H - m) dy = H - m - (sy + sh);
  if (dx || dy) { state.view.x += dx; state.view.y += dy; applyView(true); }
}

// ---------- Auswahl & Bearbeitung ----------
function select(id) {
  state.sel = id;
  state.selRel = null;
  if (isMap()) {
    applyHighlights();
    renderRelations();
    if (id) ensureVisible(id);
  }
  renderPanel();
}
function selectRel(id) {
  finishEdit();
  state.selRel = id;
  state.sel = null;
  renderRelations();
  applyHighlights();
  renderPanel();
}

function startEdit(id, { initial = null } = {}) {
  if (!isMap()) return;
  if (state.editing && state.editing !== id) finishEdit();
  const el = els.get(id);
  if (!el) return;
  state.editing = id;
  const t = el.querySelector('.t-text');
  el.classList.add('editing');
  try { t.contentEditable = 'plaintext-only'; } catch { /* ältere Browser */ }
  if (t.contentEditable !== 'plaintext-only') t.contentEditable = 'true';
  if (initial != null) t.textContent = initial;
  t.focus();
  const range = document.createRange();
  range.selectNodeContents(t);
  if (initial != null) range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  layoutPass();
  t.oninput = () => layoutPass();
  t.onkeydown = e => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(true); }
    else if (e.key === 'Tab') { e.preventDefault(); finishEdit(); addChild(id); }
  };
  t.onblur = () => finishEdit();
  ensureVisible(id);
}
function finishEdit(cancel = false) {
  const id = state.editing;
  if (!id) return;
  state.editing = null;
  const el = els.get(id);
  const t = el?.querySelector('.t-text');
  if (!t) return;
  t.onblur = t.oninput = t.onkeydown = null;
  t.contentEditable = 'false';
  t.removeAttribute('contenteditable');
  el.classList.remove('editing');
  const node = find(id);
  const text = (t.innerText || '').replace(/​/g, '').replace(/^\s+|\s+$/g, '');
  if (cancel || !node || text === node.text) {
    t.textContent = node?.text || '';
    layoutPass();
    return;
  }
  commit(() => { node.text = text; });
}

// ---------- Struktur-Operationen ----------
function defaultName(parent) {
  if (!isMap()) return '';
  return isRoot(parent.id) ? `Hauptthema ${parent.children.length + 1}` : 'Unterthema';
}
function afterCreate(id) {
  if (isMap()) { select(id); startEdit(id); }
  else { state.sel = id; focusRow(id); }
}
function addChild(id = state.sel, { index } = {}) {
  const p = find(id);
  if (!p) return;
  const n = S.topic(defaultName(p));
  commit(() => {
    p.collapsed = false;
    if (index == null) p.children.push(n); else p.children.splice(index, 0, n);
  });
  afterCreate(n.id);
}
function addSibling(id = state.sel, before = false) {
  const parent = parentOf(id);
  if (!parent) return addChild(id, { index: isMap() ? undefined : 0 });
  const n = S.topic(defaultName(parent));
  commit(() => {
    const i = parent.children.findIndex(c => c.id === id);
    parent.children.splice(before ? i : i + 1, 0, n);
  });
  afterCreate(n.id);
}
function removeNode(id = state.sel) {
  const node = find(id), parent = parentOf(id);
  if (!node) return;
  if (!parent) return toast('Das zentrale Thema kann nicht gelöscht werden');
  const i = parent.children.indexOf(node);
  const ids = new Set();
  S.walk(node, n => { ids.add(n.id); });
  commit(d => {
    parent.children.splice(i, 1);
    d.relations = d.relations.filter(r => !ids.has(r.from) && !ids.has(r.to));
  });
  const next = parent.children[Math.min(i, parent.children.length - 1)] || parent;
  select(next.id);
}
function moveSibling(id, delta) {
  const parent = parentOf(id);
  if (!parent) return;
  const p = state.layout?.pos.get(id);
  if (isMap() && p && p.dir < 0 && isRoot(parent.id)) delta = -delta; // linke Seite ist gespiegelt
  const i = parent.children.findIndex(c => c.id === id), j = i + delta;
  if (j < 0 || j >= parent.children.length) return;
  commit(() => { const [n] = parent.children.splice(i, 1); parent.children.splice(j, 0, n); });
}
function moveNode(id, targetId, where) {
  if (id === targetId || isRoot(id)) return;
  const node = find(id), target = find(targetId);
  if (!node || !target || S.contains(node, targetId)) return;
  if (where !== 'child' && isRoot(targetId)) where = 'child';
  const tp = state.layout?.pos.get(targetId);
  const tParent = where === 'child' ? target : parentOf(targetId);
  if (!tParent) return;
  if (where !== 'child' && tp && tp.dir < 0 && isRoot(tParent.id)) where = where === 'before' ? 'after' : 'before';
  commit(() => {
    const op = parentOf(id);
    op.children.splice(op.children.indexOf(node), 1);
    if (where === 'child') { target.collapsed = false; target.children.push(node); }
    else {
      const i = tParent.children.indexOf(target);
      tParent.children.splice(where === 'before' ? i : i + 1, 0, node);
    }
  });
  select(id);
}
function indent(id) {
  const parent = parentOf(id);
  if (!parent) return;
  const i = parent.children.findIndex(c => c.id === id);
  if (i <= 0) return;
  const prev = parent.children[i - 1];
  commit(() => { const [n] = parent.children.splice(i, 1); prev.collapsed = false; prev.children.push(n); });
}
function outdent(id) {
  const parent = parentOf(id);
  if (!parent) return;
  const gp = parentOf(parent.id);
  if (!gp) return;
  commit(() => {
    const [n] = parent.children.splice(parent.children.findIndex(c => c.id === id), 1);
    gp.children.splice(gp.children.indexOf(parent) + 1, 0, n);
  });
}
function duplicate(id = state.sel) {
  const parent = parentOf(id);
  if (!parent) return;
  const node = find(id), copy = S.cloneFresh(node);
  commit(() => { parent.children.splice(parent.children.indexOf(node) + 1, 0, copy); });
  select(copy.id);
}
function toggleFold(id, value) {
  const n = find(id);
  if (!n || !n.children.length || isRoot(id)) return;
  n.collapsed = value ?? !n.collapsed;
  if (n.collapsed && state.sel && state.sel !== id && S.contains(n, state.sel)) state.sel = id;
  persist();
  render();
}
function setAllFolded(collapsed) {
  S.walk(state.doc.root, (n, p, d) => { if (d > 0 && n.children.length) n.collapsed = collapsed && d === 1 ? true : collapsed ? n.collapsed : false; });
  if (collapsed && state.sel && !isRoot(state.sel)) state.sel = S.pathTo(state.doc.root, state.sel)[1]?.id || state.doc.root.id;
  persist();
  render();
  fitView();
}

// ---------- Zwischenablage ----------
function copyNode(id = state.sel) {
  const n = find(id);
  if (!n) return null;
  const text = IO.subtreeToText(n);
  state.clip = { text, node: JSON.stringify(n) };
  return text;
}
function pasteNodes(id, text) {
  const p = find(id);
  if (!p) return;
  let nodes;
  if (state.clip && (text == null || text === state.clip.text)) nodes = [S.cloneFresh(JSON.parse(state.clip.node))];
  else nodes = IO.itemsToForest(IO.parseOutlineText(text || ''));
  if (!nodes.length) return;
  commit(() => { p.collapsed = false; p.children.push(...nodes); });
  select(nodes[0].id);
  toast(nodes.length > 1 ? `${nodes.length} Themen eingefügt` : 'Eingefügt');
}
document.addEventListener('copy', e => {
  if (inField(e.target) || !isMap() || !state.sel || state.editing) return;
  const text = copyNode();
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
  toast('Kopiert');
});
document.addEventListener('cut', e => {
  if (inField(e.target) || !isMap() || !state.sel || state.editing || isRoot(state.sel)) return;
  e.clipboardData.setData('text/plain', copyNode());
  e.preventDefault();
  removeNode(state.sel);
});
document.addEventListener('paste', e => {
  if (inField(e.target) || !isMap() || !state.sel || state.editing) return;
  e.preventDefault();
  pasteNodes(state.sel, e.clipboardData.getData('text/plain'));
});

// ---------- Beziehungen ----------
function startRelation(fromId = state.sel) {
  if (!fromId) return toast('Erst ein Thema auswählen');
  state.relMode = fromId;
  canvas.classList.add('rel-mode');
  $('#btn-rel').classList.add('on');
  toast('Zielthema anklicken – Esc bricht ab', 3000);
}
function cancelRelMode() {
  state.relMode = null;
  canvas.classList.remove('rel-mode');
  $('#btn-rel').classList.remove('on');
}
function createRelation(from, to) {
  cancelRelMode();
  if (from === to) return;
  const r = { id: S.uid(), from, to, label: '' };
  commit(d => { d.relations.push(r); });
  selectRel(r.id);
  setTimeout(() => $('#rel-label')?.focus(), 0);
}
function deleteRelation(id) {
  commit(d => { d.relations = d.relations.filter(r => r.id !== id); });
  state.selRel = null;
  render();
}

// ---------- Navigation ----------
function navigate(key) {
  const L = state.layout, cur = L?.pos.get(state.sel);
  if (!cur) return;
  const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  let best = null, bestScore = Infinity;
  for (const [id, p] of L.pos) {
    if (id === state.sel) continue;
    const dx = p.x + p.w / 2 - cx, dy = p.y + p.h / 2 - cy;
    const along = dx * v[0] + dy * v[1];
    if (along <= 2) continue;
    const perp = Math.abs(dx * v[1] - dy * v[0]);
    const score = along + perp * 2.5;
    if (score < bestScore) { bestScore = score; best = id; }
  }
  if (best) select(best);
}

// ---------- Tastatur ----------
document.addEventListener('keydown', e => {
  if (state.ctx && e.key === 'Escape') return closeCtx();
  if (state.present) return presentKey(e);
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const field = inField(e.target);
  if (mod && k === 's') { e.preventDefault(); toast('Wird automatisch gespeichert ✓'); return; }
  if (mod && k === 'f') { e.preventDefault(); openSearch(); return; }
  if (field) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (!isMap()) return;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); return; }
  if (mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); return; }
  if (mod && e.key === '0') { e.preventDefault(); fitView(); return; }
  if (e.key === 'Escape') {
    if (state.relMode) return cancelRelMode();
    if (!$('#search').hidden) return closeSearch();
    state.sel = null; state.selRel = null; applyHighlights(); renderRelations(); renderPanel();
    return;
  }
  if (state.selRel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteRelation(state.selRel); return; }
  const id = state.sel;
  if (!id) {
    if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); select(state.doc.root.id); }
    return;
  }
  if (mod && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); toggleFold(id); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(id); return; }
  if (mod && k === 'a') { e.preventDefault(); return; }
  switch (e.key) {
    case 'Tab': e.preventDefault(); if (!e.shiftKey) addChild(id); break;
    case 'Insert': e.preventDefault(); addChild(id); break;
    case 'Enter': e.preventDefault(); addSibling(id, e.shiftKey); break;
    case 'Delete': case 'Backspace': e.preventDefault(); removeNode(id); break;
    case 'F2': case ' ': e.preventDefault(); startEdit(id); break;
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
      e.preventDefault();
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) moveSibling(id, e.key === 'ArrowUp' ? -1 : 1);
      else navigate(e.key);
      break;
    default:
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(id, { initial: e.key }); }
  }
});

// ---------- Maus auf dem Canvas ----------
canvas.addEventListener('pointerdown', e => {
  closeCtx();
  if (e.button !== 0 && e.button !== 1) return;
  const topicEl = e.target.closest('.topic');
  if (e.target.closest('.t-fold') || e.target.closest('a')) return;
  if (state.editing && topicEl?.dataset.id === state.editing) return;
  if (state.editing) finishEdit();
  const relG = e.target.closest('.rel');
  if (relG && !topicEl) { e.preventDefault(); selectRel(relG.dataset.rel); return; }
  if (topicEl && e.button === 0 && !state.present) { onTopicDown(e, topicEl); return; }
  startPan(e);
});
canvas.addEventListener('click', e => {
  const f = e.target.closest('.t-fold');
  if (f) { e.stopPropagation(); toggleFold(f.closest('.topic').dataset.id); }
});
canvas.addEventListener('dblclick', e => {
  if (state.present) return;
  const t = e.target.closest('.topic');
  if (t && !e.target.closest('.t-fold')) { startEdit(t.dataset.id); return; }
  const rel = e.target.closest('.rel');
  if (rel) { selectRel(rel.dataset.rel); $('#rel-label')?.focus(); }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  closeCtx();
  world.classList.remove('animate');
  if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  else { state.view.x -= e.deltaX; state.view.y -= e.deltaY; applyView(); }
}, { passive: false });
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (state.present) return;
  const t = e.target.closest('.topic');
  if (t) {
    const id = t.dataset.id, n = find(id);
    select(id);
    const m = isMac ? '⌘' : 'Strg+';
    showCtx(e.clientX, e.clientY, [
      { label: 'Unterthema hinzufügen', key: 'Tab', run: () => addChild(id) },
      { label: 'Gleichrangiges Thema', key: 'Enter', run: () => addSibling(id) },
      { label: 'Text bearbeiten', key: 'F2', run: () => startEdit(id) },
      '-',
      { label: n.collapsed ? 'Ausklappen' : 'Einklappen', key: `${m}/`, disabled: !n.children.length || isRoot(id), run: () => toggleFold(id) },
      { label: 'Beziehung zeichnen', run: () => startRelation(id) },
      '-',
      { label: 'Kopieren', key: `${m}C`, run: () => { const txt = copyNode(id); navigator.clipboard?.writeText(txt).catch(() => {}); toast('Kopiert'); } },
      { label: 'Einfügen als Unterthema', key: `${m}V`, disabled: !state.clip, run: () => pasteNodes(id) },
      { label: 'Duplizieren', key: `${m}D`, disabled: isRoot(id), run: () => duplicate(id) },
      '-',
      { label: 'Löschen', key: 'Entf', disabled: isRoot(id), run: () => removeNode(id) },
    ]);
  } else {
    showCtx(e.clientX, e.clientY, [
      { label: 'Einpassen', key: isMac ? '⌘0' : 'Strg+0', run: () => fitView() },
      { label: 'Alles ausklappen', run: () => setAllFolded(false) },
      { label: 'Hauptäste einklappen', run: () => setAllFolded(true) },
    ]);
  }
});

function onTopicDown(e, el) {
  const id = el.dataset.id;
  e.preventDefault();
  if (state.relMode) { createRelation(state.relMode, id); return; }
  select(id);
  if (isRoot(id)) { startPan(e, { deselect: false }); return; }
  const start = { x: e.clientX, y: e.clientY };
  let drag = null;
  const move = ev => {
    if (!drag) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      drag = beginDrag(el, ev);
    }
    updateDrag(drag, ev);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (drag) endDrag(drag);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function beginDrag(el, ev) {
  const ghost = el.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('selected');
  ghost.style.transform = `scale(${state.view.scale})`;
  document.body.appendChild(ghost);
  el.classList.add('dragging');
  return { id: el.dataset.id, el, ghost, target: null, where: null, under: null };
}
function clearDropMarks(d) {
  if (d.under) d.under.classList.remove('drop-child', 'drop-before', 'drop-after');
  d.under = null;
}
function updateDrag(d, ev) {
  d.ghost.style.left = ev.clientX + 10 + 'px';
  d.ghost.style.top = ev.clientY + 10 + 'px';
  clearDropMarks(d);
  d.target = null;
  const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.topic');
  if (!under || under === d.el || under.classList.contains('ghost')) return;
  const tid = under.dataset.id;
  if (S.contains(find(d.id), tid)) return;
  const r = under.getBoundingClientRect();
  let where = 'child';
  if (!isRoot(tid)) {
    const horizontal = under.dataset.side === 'b';
    const ratio = horizontal ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
    if (ratio < 0.25) where = 'before'; else if (ratio > 0.75) where = 'after';
  }
  under.classList.add('drop-' + where);
  d.under = under;
  d.target = tid;
  d.where = where;
}
function endDrag(d) {
  d.ghost.remove();
  d.el.classList.remove('dragging');
  clearDropMarks(d);
  if (d.target) moveNode(d.id, d.target, d.where);
}

function startPan(e, { deselect = true } = {}) {
  const sx = e.clientX, sy = e.clientY, vx = state.view.x, vy = state.view.y;
  let moved = false;
  world.classList.remove('animate');
  try { canvas.setPointerCapture(e.pointerId); } catch { /* egal */ }
  const move = ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    canvas.classList.add('panning');
    state.view.x = vx + dx;
    state.view.y = vy + dy;
    applyView();
  };
  const up = () => {
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.classList.remove('panning');
    if (!moved && deselect && !state.present) {
      if (state.relMode) cancelRelMode();
      state.sel = null;
      state.selRel = null;
      applyHighlights();
      renderRelations();
      renderPanel();
    }
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}

// ---------- Kontextmenü ----------
function showCtx(x, y, items) {
  closeCtx();
  const m = document.createElement('div');
  m.className = 'menu ctxmenu';
  m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>'
    : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}><span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span></button>`)).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-i]');
    if (!b || b.disabled) return;
    closeCtx();
    items[+b.dataset.i].run();
  });
  state.ctx = m;
}
function closeCtx() { state.ctx?.remove(); state.ctx = null; }
document.addEventListener('pointerdown', e => { if (state.ctx && !state.ctx.contains(e.target)) closeCtx(); }, true);

// ---------- Panel ----------
const SWATCHES = ['#e5484d', '#f76b15', '#e2a106', '#30a46c', '#12a594', '#0091ff', '#3e63dd', '#8e4ec6', '#d6409f', '#1e2330', '#8b8d98'];
function renderPanel() {
  if (!state.doc) return;
  const active = document.activeElement;
  const focusKey = panelEl.contains(active) ? (active.dataset.f || active.dataset.map || active.id) : null;
  const doc = state.doc;
  let html = '';
  const rel = state.selRel && doc.relations.find(r => r.id === state.selRel);
  if (rel) {
    const a = find(rel.from), b = find(rel.to);
    html += `<section><h3>Beziehung</h3>
      <p class="hint" style="margin-bottom:10px">${esc(a?.text || '?')} → ${esc(b?.text || '?')}</p>
      <label>Beschriftung<input id="rel-label" value="${esc(rel.label)}" placeholder="z. B. beeinflusst"></label>
      <div class="row-btns"><button class="btn danger" id="rel-del">${icon('trash')}Beziehung löschen</button></div></section>`;
  } else if (state.sel && find(state.sel)) {
    const n = find(state.sel);
    const mk = id => `<button class="mk-btn${n.markers.includes(id) ? ' on' : ''}" data-mk="${id}">${markerHTML(id)}</button>`;
    html += `<section><h3>Thema</h3>
      <label>Text<textarea data-f="text" rows="2">${esc(n.text)}</textarea></label>
      <label>Notiz<textarea data-f="note" rows="4" placeholder="Notiz hinzufügen…">${esc(n.note)}</textarea></label>
      <label>Link<input data-f="link" type="url" placeholder="https://…" value="${esc(n.link)}"></label>
      <label style="margin-bottom:0">Labels<input data-f="labels" placeholder="Komma-getrennt" value="${esc(n.labels.join(', '))}"></label>
    </section>
    <section><h3>Marker</h3>
      <div class="mk-sub">Priorität</div><div class="mk-grid">${[1, 2, 3, 4, 5, 6].map(i => mk('p' + i)).join('')}</div>
      <div class="mk-sub">Fortschritt</div><div class="mk-grid">${S.PROGRESS.map(mk).join('')}</div>
      <div class="mk-sub">Symbole</div><div class="mk-grid">${Object.keys(S.SYMBOLS).map(mk).join('')}</div>
    </section>
    <section><h3>Farbe</h3><div class="swatches">
      <button class="sw reset${n.color ? '' : ' on'}" data-sw="" title="Automatisch"></button>
      ${SWATCHES.map(c => `<button class="sw${n.color === c ? ' on' : ''}" data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <input type="color" data-color="custom" value="${n.color || '#4f46e5'}" title="Eigene Farbe">
    </div></section>`;
  } else {
    html += '<section><p class="hint">Wähle ein Thema aus, um Text, Notiz, Marker und Farbe zu bearbeiten.</p></section>';
  }
  html += `<section><h3>Karte</h3>
    <label>Struktur<select data-map="structure">${Object.entries(STRUCTURES).map(([k, v]) => `<option value="${k}"${doc.structure === k ? ' selected' : ''}>${v.name}</option>`).join('')}</select></label>
    <div class="mk-sub">Design</div>
    <div class="theme-grid">${Object.entries(S.THEMES).map(([k, t]) => `<button class="theme-card${doc.theme === k ? ' on' : ''}" data-theme="${k}" style="--tbg:${t.bg};--tfg:${t.text}">${t.name}<div class="stripes"><i style="background:${t.rootBg}"></i>${t.palette.slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</div></button>`).join('')}</div>
    <p class="stats">${S.count(doc.root)} Themen · ${doc.relations.length} Beziehungen</p>
  </section>
  <section><details class="keys"><summary>Tastenkürzel</summary><dl>
    <dt>Tab</dt><dd>Unterthema</dd><dt>Enter</dt><dd>Gleichrangiges Thema</dd><dt>⇧ Enter</dt><dd>Thema davor</dd>
    <dt>F2 / Leertaste</dt><dd>Bearbeiten (oder einfach lostippen)</dd><dt>Entf</dt><dd>Löschen</dd>
    <dt>Pfeiltasten</dt><dd>Navigieren</dd><dt>⌥ ↑ / ↓</dt><dd>Verschieben</dd><dt>⌘ /</dt><dd>Ein-/Ausklappen</dd>
    <dt>⌘ C / X / V</dt><dd>Kopieren, Ausschneiden, Einfügen</dd><dt>⌘ D</dt><dd>Duplizieren</dd>
    <dt>⌘ Z / ⇧⌘ Z</dt><dd>Rückgängig / Wiederholen</dd><dt>⌘ F</dt><dd>Suchen</dd><dt>⌘ 0</dt><dd>Einpassen</dd>
    <dt>Scrollen</dt><dd>Verschieben · mit ⌘/Pinch zoomen</dd><dt>Ziehen</dt><dd>Thema umhängen</dd>
  </dl></details></section>`;
  panelEl.innerHTML = html;
  if (focusKey) {
    const el = panelEl.querySelector(`[data-f="${focusKey}"], [data-map="${focusKey}"], #${CSS.escape(focusKey)}`);
    if (el) { el.focus(); if (el.setSelectionRange && el.type !== 'url') { const l = el.value.length; try { el.setSelectionRange(l, l); } catch { /* */ } } }
  }
}
panelEl.addEventListener('change', e => {
  const t = e.target;
  const n = state.sel && find(state.sel);
  if (t.dataset.f && n) {
    let v = t.value;
    const f = t.dataset.f;
    if (f === 'labels') v = v.split(',').map(s => s.trim()).filter(Boolean);
    else if (f === 'text') v = v.trim();
    else if (f === 'link') { v = v.trim(); if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v; }
    if (JSON.stringify(v) === JSON.stringify(n[f])) return;
    commit(() => { n[f] = v; });
    return;
  }
  if (t.dataset.color === 'custom' && n) { commit(() => { n.color = t.value; }); return; }
  if (t.dataset.map === 'structure') {
    commit(d => { d.structure = t.value; });
    requestAnimationFrame(() => fitView());
    return;
  }
  if (t.id === 'rel-label') {
    const r = state.doc.relations.find(x => x.id === state.selRel);
    if (r) commit(() => { r.label = t.value.trim(); });
  }
});
panelEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.dataset.f === 'text' && !e.shiftKey))) {
    e.preventDefault();
    e.target.blur();
  }
});
panelEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const n = state.sel && find(state.sel);
  if (b.dataset.mk && n) commit(() => { n.markers = S.toggleMarker(n.markers, b.dataset.mk); });
  else if (b.dataset.sw !== undefined && n) commit(() => { n.color = b.dataset.sw || null; });
  else if (b.dataset.theme) commit(d => { d.theme = b.dataset.theme; });
  else if (b.id === 'rel-del') deleteRelation(state.selRel);
});

// ---------- Sidebar ----------
function renderSidebar() {
  const list = S.storage.list();
  $('#doclist').innerHTML = list.map(d => `<li data-id="${d.id}" class="${d.id === state.doc?.id ? 'active' : ''}">
    <div class="d-title">${esc(d.title || 'Ohne Titel')}</div><div class="d-meta">${ago(d.updatedAt)}</div>
    <button class="d-del" title="Löschen">${icon('trash')}</button></li>`).join('');
}
$('#doclist').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const del = e.target.closest('.d-del');
  if (del) {
    e.stopPropagation();
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm');
      del.textContent = 'Löschen?';
      setTimeout(() => { if (del.isConnected) { del.classList.remove('confirm'); del.innerHTML = icon('trash'); } }, 3000);
      return;
    }
    S.storage.remove(li.dataset.id);
    if (li.dataset.id === state.doc.id) {
      const next = S.storage.list()[0];
      let d = next && S.storage.load(next.id);
      if (!d) { d = S.TEMPLATES[0].build(); S.storage.save(d); }
      openDoc(d);
    } else renderSidebar();
    toast('Map gelöscht');
    return;
  }
  if (li.dataset.id !== state.doc.id) {
    const d = S.storage.load(li.dataset.id);
    if (d) openDoc(d);
  }
});

function openTemplates() {
  $('#tpl-grid').innerHTML = S.TEMPLATES.map(t => `<button class="tpl" data-tpl="${t.id}"><div class="pv">${STRUCT_ICONS[t.structure]}</div><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('');
  $('#dlg-new').showModal();
}
$('#tpl-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  const t = S.TEMPLATES.find(x => x.id === b.dataset.tpl);
  const d = t.build();
  S.storage.save(d);
  $('#dlg-new').close();
  openDoc(d);
  if (isMap()) { select(d.root.id); startEdit(d.root.id); }
});
$('#dlg-new').addEventListener('click', e => {
  if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#dlg-new').close();
});

// ---------- Gliederung ----------
function renderOutline() {
  const active = document.activeElement;
  const activeId = outlineEl.contains(active) ? active.closest('.ol-row')?.dataset.id : null;
  const caret = activeId ? active.selectionStart : null;
  const rows = [];
  S.walk(state.doc.root, (n, p, d) => {
    rows.push(`<div class="ol-row d${Math.min(d, 3)}" style="--d:${d}" data-id="${n.id}"><button class="ol-bul${n.children.length ? ' has' : ''}${n.collapsed ? ' col' : ''}" tabindex="-1" title="${n.collapsed ? 'Ausklappen' : n.children.length ? 'Einklappen' : ''}"></button><input class="ol-in" value="${esc(n.text)}" placeholder="${d === 0 ? 'Zentrales Thema' : 'Thema'}" spellcheck="false"></div>`);
    if (n.collapsed) return false;
  });
  outlineEl.innerHTML = `<div class="ol-doc">${rows.join('')}</div><p class="ol-hint">Enter: neues Thema · Tab / ⇧Tab: ein-/ausrücken · ⌥↑/↓: verschieben · Rücktaste in leerer Zeile: löschen</p>`;
  if (activeId) focusRow(activeId, caret);
}
function focusRow(id, caret = null) {
  const inp = outlineEl.querySelector(`.ol-row[data-id="${id}"] .ol-in`);
  if (!inp) return;
  inp.focus();
  const p = caret == null ? inp.value.length : Math.min(caret, inp.value.length);
  inp.setSelectionRange(p, p);
}
const rowIds = () => [...outlineEl.querySelectorAll('.ol-row')].map(r => r.dataset.id);
function neighborRow(id, delta) { const ids = rowIds(); return ids[ids.indexOf(id) + delta] || null; }
outlineEl.addEventListener('input', e => {
  const inp = e.target.closest('.ol-in');
  if (!inp) return;
  const n = find(inp.closest('.ol-row').dataset.id);
  if (!n) return;
  if (!state.olSnap) state.olSnap = snapshot();
  n.text = inp.value;
  if (isRoot(n.id)) document.title = `${state.doc.title} – Mindwerk`;
  persistSoon();
  updateUndoButtons();
});
outlineEl.addEventListener('focusout', () => { flushOutlineSnap(); updateUndoButtons(); });
outlineEl.addEventListener('focusin', e => {
  const r = e.target.closest('.ol-row');
  if (r && state.sel !== r.dataset.id) { state.sel = r.dataset.id; renderPanel(); }
});
outlineEl.addEventListener('click', e => {
  const b = e.target.closest('.ol-bul.has');
  if (b) toggleFold(b.closest('.ol-row').dataset.id);
});
outlineEl.addEventListener('keydown', e => {
  const inp = e.target.closest('.ol-in');
  if (!inp || e.isComposing) return;
  const id = inp.closest('.ol-row').dataset.id;
  const n = find(id);
  const mod = e.metaKey || e.ctrlKey;
  const caret = inp.selectionStart;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); focusRow(state.sel || id); return; }
  if (e.key === 'Enter') { e.preventDefault(); isRoot(id) ? addChild(id, { index: 0 }) : addSibling(id); return; }
  if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? outdent(id) : indent(id); focusRow(id, caret); return; }
  if (e.key === 'Backspace' && inp.value === '' && !isRoot(id) && !n.children.length) {
    e.preventDefault();
    const prev = neighborRow(id, -1);
    removeNode(id);
    if (prev) focusRow(prev);
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (e.altKey) { moveSibling(id, e.key === 'ArrowUp' ? -1 : 1); focusRow(id, caret); }
    else { const o = neighborRow(id, e.key === 'ArrowUp' ? -1 : 1); if (o) focusRow(o, caret); }
  }
});

function setMode(m) {
  if (state.mode === m) return;
  if (state.present) stopPresent();
  finishEdit();
  flushOutlineSnap();
  clearTimeout(persistTimer);
  persist();
  state.mode = m;
  canvas.hidden = m !== 'map';
  outlineEl.hidden = m !== 'outline';
  $('#zoombar').hidden = m !== 'map';
  $('#btn-outline').classList.toggle('on', m === 'outline');
  render();
  if (m === 'map') fitView(false);
  else focusRow(state.sel || state.doc.root.id);
}

// ---------- Suche ----------
function openSearch() {
  if (!isMap()) setMode('map');
  $('#search').hidden = false;
  const inp = $('#search-in');
  inp.focus();
  inp.select();
  runSearch(inp.value);
}
function closeSearch() {
  $('#search').hidden = true;
  state.search = { hits: [], i: -1 };
  applyHighlights();
}
function runSearch(q) {
  q = q.trim().toLowerCase();
  const hits = [];
  if (q) S.walk(state.doc.root, n => {
    if ([n.text, n.note, ...n.labels].some(s => s && s.toLowerCase().includes(q))) hits.push(n.id);
  });
  state.search = { hits, i: -1 };
  $('#search-count').textContent = q ? `${hits.length} ${hits.length === 1 ? 'Treffer' : 'Treffer'}` : '';
  applyHighlights();
}
function stepSearch(dir) {
  const s = state.search;
  if (!s.hits.length) return;
  s.i = (s.i + dir + s.hits.length) % s.hits.length;
  const id = s.hits[s.i];
  let changed = false;
  for (const a of S.pathTo(state.doc.root, id).slice(0, -1)) if (a.collapsed) { a.collapsed = false; changed = true; }
  if (changed) { persist(); render(); }
  select(id);
  centerOn(id);
  $('#search-count').textContent = `${s.i + 1} / ${s.hits.length}`;
}
$('#search-in').addEventListener('input', e => runSearch(e.target.value));
$('#search-in').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
});
$('#search-next').addEventListener('click', () => stepSearch(1));
$('#search-prev').addEventListener('click', () => stepSearch(-1));
$('#search-close').addEventListener('click', closeSearch);

// ---------- Präsentation ----------
function startPresent() {
  finishEdit();
  if (!isMap()) setMode('map');
  closeSearch();
  cancelRelMode();
  const slides = [null, ...state.doc.root.children.map(c => c.id)];
  state.present = { slides, i: 0, focus: null };
  document.body.classList.add('presenting');
  document.documentElement.requestFullscreen?.().catch(() => {});
  setTimeout(showSlide, 80);
}
function showSlide() {
  const P = state.present;
  if (!P) return;
  const id = P.slides[P.i];
  let n = id && find(id);
  if (n?.collapsed) { n.collapsed = false; render(); }
  const L = state.layout;
  let b = L.bounds;
  P.focus = null;
  if (n) {
    P.focus = new Set();
    S.walk(n, x => { if (L.pos.has(x.id)) P.focus.add(x.id); });
    b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const fid of P.focus) {
      const p = L.pos.get(fid);
      b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x + p.w); b.maxY = Math.max(b.maxY, p.y + p.h);
    }
  }
  applyHighlights();
  fitBounds(b, true, 1.8);
  $('#present-counter').textContent = `${P.i + 1} / ${P.slides.length}`;
}
function stepPresent(d) {
  const P = state.present;
  if (!P) return;
  P.i = Math.max(0, Math.min(P.slides.length - 1, P.i + d));
  showSlide();
}
function stopPresent() {
  if (!state.present) return;
  state.present = null;
  document.body.classList.remove('presenting');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  applyHighlights();
  setTimeout(() => fitView(), 80);
}
function presentKey(e) {
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); stepPresent(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); stepPresent(-1); }
  else if (e.key === 'Escape') { e.preventDefault(); stopPresent(); }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.present) stopPresent(); });
$('#p-next').addEventListener('click', () => stepPresent(1));
$('#p-prev').addEventListener('click', () => stepPresent(-1));
$('#p-exit').addEventListener('click', stopPresent);

// ---------- Export / Import ----------
function buildExportSVG() {
  const L = state.layout, th = theme();
  const index = new Map();
  S.walk(state.doc.root, n => { index.set(n.id, n); });
  const nodes = [];
  for (const [id, p] of L.pos) {
    const n = index.get(id), m = state.meta.get(id);
    if (!n || !m) continue;
    nodes.push({ ...p, text: n.text, markers: n.markers, labels: n.labels, note: !!n.note, link: !!n.link, fill: m.fill, fg: m.fg, border: m.border });
  }
  const edges = L.edges.map(e => ({ d: edgePath(e, L.pos), color: state.meta.get(e.to)?.color || '#999', width: edgeWidth(e.depth) }));
  const relations = state.doc.relations.map(r => {
    const a = L.pos.get(r.from), b = L.pos.get(r.to);
    if (!a || !b) return null;
    const rp = relationPath(a, b);
    return { d: rp.d, label: r.label, lx: rp.label.x, ly: rp.label.y };
  }).filter(Boolean);
  return IO.toSVG({ nodes, edges, relations, bounds: L.bounds, bg: th.bg, text: th.text, relColor: th.rel });
}
async function doExport(kind) {
  finishEdit();
  const doc = state.doc, name = IO.safeName(doc.title);
  try {
    if (kind === 'png' || kind === 'svg') {
      if (!isMap()) setMode('map');
      const { svg, w, h } = buildExportSVG();
      if (kind === 'svg') IO.download(name + '.svg', svg, 'image/svg+xml');
      else IO.download(name + '.png', await IO.svgToPng(svg, w, h));
    } else if (kind === 'md') IO.download(name + '.md', IO.toMarkdown(doc), 'text/markdown');
    else if (kind === 'opml') IO.download(name + '.opml', IO.toOPML(doc), 'text/x-opml');
    else if (kind === 'json') IO.download(name + '.json', IO.toJSON(doc), 'application/json');
    else if (kind === 'xmind') IO.download(name + '.xmind', await IO.toXmind(doc));
    toast('Exportiert ✓');
  } catch (err) {
    console.error(err);
    toast('Export fehlgeschlagen: ' + err.message, 4000);
  }
}
async function importFiles(files) {
  const file = files?.[0];
  if (!file) return;
  try {
    const docs = await IO.importFile(file);
    if (!docs.length) throw new Error('Keine Inhalte gefunden');
    docs.forEach(d => S.storage.save(d));
    openDoc(docs[0]);
    toast(`„${docs[0].title}“ importiert${docs.length > 1 ? ` (+${docs.length - 1} weitere Blätter in der Liste)` : ''}`, 3200);
  } catch (err) {
    console.error(err);
    toast('Import fehlgeschlagen: ' + err.message, 4000);
  }
}
$('#file-input').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  importFiles(e.dataTransfer.files);
});

// ---------- Toolbar ----------
function setChrome(cls, on) {
  document.body.classList.toggle(cls, !on);
  try { localStorage.setItem('mindwerk:' + cls, on ? '0' : '1'); } catch { /* */ }
  $('#btn-sidebar').classList.toggle('on', !document.body.classList.contains('no-sidebar'));
  $('#btn-panel').classList.toggle('on', !document.body.classList.contains('no-panel'));
}
function bindToolbar() {
  const on = (id, fn) => $(id).addEventListener('click', e => { e.currentTarget.blur(); fn(e); });
  on('#btn-sidebar', () => setChrome('no-sidebar', document.body.classList.contains('no-sidebar')));
  on('#btn-panel', () => setChrome('no-panel', document.body.classList.contains('no-panel')));
  on('#btn-undo', undo);
  on('#btn-redo', redo);
  on('#btn-child', () => { if (!isMap()) setMode('map'); addChild(state.sel || state.doc.root.id); });
  on('#btn-sibling', () => { if (!isMap()) setMode('map'); addSibling(state.sel || state.doc.root.id); });
  on('#btn-rel', () => { if (state.relMode) cancelRelMode(); else { if (!isMap()) setMode('map'); startRelation(); } });
  on('#btn-search', openSearch);
  on('#btn-outline', () => setMode(isMap() ? 'outline' : 'map'));
  on('#btn-present', startPresent);
  on('#btn-import', () => $('#file-input').click());
  on('#btn-new', openTemplates);
  on('#z-in', () => zoomBy(1.2));
  on('#z-out', () => zoomBy(1 / 1.2));
  on('#z-fit', () => fitView());
  on('#zoom-label', () => {
    const r = canvas.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / state.view.scale, true);
  });
  const title = $('#doc-title');
  title.addEventListener('change', () => {
    const v = title.value.trim() || 'Ohne Titel';
    if (v !== state.doc.title) commit(d => { d.title = v; });
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); title.blur(); } });
  document.addEventListener('click', e => {
    const dd = e.target.closest('[data-dd]');
    document.querySelectorAll('.dropdown.open').forEach(d => { if (!dd || d !== dd.parentElement) d.classList.remove('open'); });
    if (dd) dd.parentElement.classList.toggle('open');
    const ex = e.target.closest('[data-export]');
    if (ex) { ex.closest('.dropdown').classList.remove('open'); doExport(ex.dataset.export); }
  });
}

// ---------- Start ----------
function boot() {
  injectIcons();
  bindToolbar();
  const pref = k => { try { return localStorage.getItem('mindwerk:' + k); } catch { return null; } };
  const narrow = innerWidth < 900;
  if (pref('no-sidebar') === '1' || (narrow && pref('no-sidebar') == null)) document.body.classList.add('no-sidebar');
  if (pref('no-panel') === '1' || (narrow && pref('no-panel') == null)) document.body.classList.add('no-panel');
  setChrome('no-sidebar', !document.body.classList.contains('no-sidebar'));
  setChrome('no-panel', !document.body.classList.contains('no-panel'));
  let doc = null;
  const last = S.storage.last();
  if (last) doc = S.storage.load(last);
  if (!doc) { const first = S.storage.list()[0]; doc = first && S.storage.load(first.id); }
  if (!doc) { doc = S.welcomeDoc(); S.storage.save(doc); }
  openDoc(doc);
  // Falls der Canvas beim Start noch keine Größe hatte: einpassen, sobald er eine bekommt.
  let hadSize = canvas.clientWidth > 0 && canvas.clientHeight > 0;
  new ResizeObserver(() => {
    const has = canvas.clientWidth > 0 && canvas.clientHeight > 0;
    if (has && !hadSize && isMap() && state.layout) { renderCanvas(); fitView(false); }
    hadSize = has;
  }).observe(canvas);
}
boot();
window.mindwerk = { state, buildExportSVG, render }; // für Debugging in der Konsole
