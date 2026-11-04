// Import & Export: JSON, Markdown, OPML, XMind (.xmind), SVG, PNG.
import { topic, newDoc, normalizeDoc, uid, toggleMarker, SYMBOLS } from './store.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xmlAttr = s => esc(s).replace(/\n/g, '&#10;');

// Gemeinsame Typografie für Canvas und Export (Canvas setzt diese Werte inline).
export const TOPIC_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const TOPIC_STYLE = [
  { size: 20, weight: 700, lh: 1.3, px: 22, py: 13, radius: 12, maxW: 360 },
  { size: 15, weight: 600, lh: 1.35, px: 15, py: 8, radius: 9, maxW: 300 },
  { size: 13.5, weight: 500, lh: 1.4, px: 11, py: 5, radius: 7, maxW: 260 },
];
export const styleFor = d => TOPIC_STYLE[Math.min(d, 2)];

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export const safeName = s => (s || 'mindmap').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindmap';

// ---------- Text / Markdown ----------
const oneLine = s => String(s).replace(/\s*\n\s*/g, ' ');

export function toMarkdown(doc) {
  const out = [`# ${oneLine(doc.root.text)}`];
  if (doc.root.note) out.push('', ...doc.root.note.split('\n').map(l => `> ${l}`));
  out.push('');
  const rec = (n, d) => {
    const ind = '  '.repeat(d);
    out.push(`${ind}- ${oneLine(n.text)}`);
    if (n.note) n.note.split('\n').forEach(l => out.push(`${ind}  > ${l}`));
    n.children.forEach(c => rec(c, d + 1));
  };
  doc.root.children.forEach(c => rec(c, 0));
  return out.join('\n') + '\n';
}

export function subtreeToText(node) {
  const out = [];
  const rec = (n, d) => { out.push('  '.repeat(d) + oneLine(n.text)); n.children.forEach(c => rec(c, d + 1)); };
  rec(node, 0);
  return out.join('\n');
}

export function parseOutlineText(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const widthOf = raw => raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
  let unit = 0;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const w = widthOf(raw);
    if (w) unit = unit ? Math.min(unit, w) : w;
  }
  unit = unit || 2;
  const items = [];
  let lastHeading = -1;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let s = raw.trim();
    const h = s.match(/^(#{1,6})\s+(.*)$/);
    if (h) { lastHeading = h[1].length - 1; items.push({ level: lastHeading, text: h[2].trim() }); continue; }
    const q = s.match(/^>\s?(.*)$/);
    if (q) {
      const last = items[items.length - 1];
      if (last) last.note = (last.note ? last.note + '\n' : '') + q[1];
      continue;
    }
    s = s.replace(/^([-*+•]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '');
    items.push({ level: lastHeading + 1 + Math.round(widthOf(raw) / unit), text: s });
  }
  return items;
}

export function itemsToForest(items) {
  const roots = [], stack = [];
  for (const it of items) {
    const n = topic(it.text);
    if (it.note) n.note = it.note;
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(n); else roots.push(n);
    stack.push({ level: it.level, node: n });
  }
  return roots;
}

function forestToRoot(roots, title) {
  if (roots.length === 1) return roots[0];
  const r = topic(title || 'Importiert');
  r.children = roots;
  return r;
}

export function fromMarkdown(text, fallbackTitle) {
  const roots = itemsToForest(parseOutlineText(text));
  if (!roots.length) throw new Error('Datei enthält keine Themen');
  const root = forestToRoot(roots, fallbackTitle);
  return newDoc(root.text || fallbackTitle, root);
}

// ---------- OPML ----------
export function toOPML(doc) {
  const rec = (n, ind) => {
    const attrs = `text="${xmlAttr(n.text)}"${n.note ? ` _note="${xmlAttr(n.note)}"` : ''}`;
    if (!n.children.length) return `${ind}<outline ${attrs}/>`;
    return `${ind}<outline ${attrs}>\n${n.children.map(c => rec(c, ind + '  ')).join('\n')}\n${ind}</outline>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${esc(doc.title)}</title></head>\n  <body>\n${rec(doc.root, '    ')}\n  </body>\n</opml>\n`;
}

export function fromOPML(text) {
  const x = new DOMParser().parseFromString(text, 'text/xml');
  if (x.querySelector('parsererror')) throw new Error('OPML-Datei ist ungültig');
  const body = x.querySelector('body');
  if (!body) throw new Error('OPML ohne <body>');
  const conv = el => {
    const n = topic(el.getAttribute('text') || el.getAttribute('title') || '');
    n.note = el.getAttribute('_note') || '';
    n.children = [...el.children].filter(c => c.localName === 'outline').map(conv);
    return n;
  };
  const roots = [...body.children].filter(c => c.localName === 'outline').map(conv);
  if (!roots.length) throw new Error('OPML enthält keine Themen');
  const title = x.querySelector('head > title')?.textContent?.trim();
  return newDoc(title || roots[0].text, forestToRoot(roots, title));
}

// ---------- JSON ----------
export const toJSON = doc => JSON.stringify({ format: 'mindwerk', version: 1, doc }, null, 2);
export function fromJSON(text) {
  const obj = JSON.parse(text);
  const d = obj.doc || obj;
  if (!d.root) throw new Error('Keine Mindwerk-Datei');
  return normalizeDoc({ ...d, id: uid() });
}

// ---------- XMind ----------
const XM_STRUCT = {
  mindmap: 'org.xmind.ui.map.clockwise', logic: 'org.xmind.ui.logic.right', org: 'org.xmind.ui.org-chart.down',
  tree: 'org.xmind.ui.tree.right', timeline: 'org.xmind.ui.timeline.horizontal',
};
const structFromXmind = (cls = '') =>
  cls.includes('logic') ? 'logic' : cls.includes('org-chart') ? 'org' : cls.includes('tree') ? 'tree' : cls.includes('timeline') ? 'timeline' : 'mindmap';

const TASK_MAP = { t0: 'task-start', t25: 'task-quarter', t50: 'task-half', t75: 'task-3quar', t100: 'task-done' };
const SYM_MAP = { star: 'star-orange', flag: 'flag-red', ok: 'symbol-right', no: 'symbol-wrong', question: 'symbol-question', warn: 'symbol-exclam', up: 'smiley-smile' };
function markerToX(m) {
  if (/^p\d$/.test(m)) return 'priority-' + m.slice(1);
  return TASK_MAP[m] || SYM_MAP[m] || null;
}
function markerFromX(id = '') {
  let m;
  if ((m = id.match(/^priority-(\d)$/))) return 'p' + Math.min(6, +m[1]);
  const task = Object.entries(TASK_MAP).find(([, v]) => v === id);
  if (task) return task[0];
  if (id === 'task-oct') return 't25';
  if (id === 'task-5oct' || id === 'task-3oct') return 't50';
  if (id === 'task-7oct') return 't75';
  if (id.startsWith('star-')) return 'star';
  if (id.startsWith('flag-')) return 'flag';
  if (id.startsWith('smiley-')) return 'up';
  const sym = { 'symbol-right': 'ok', 'symbol-wrong': 'no', 'symbol-question': 'question', 'symbol-exclam': 'warn' }[id];
  return sym || null;
}
const cleanMarkers = list => list.filter(Boolean).reduce((acc, m) => (acc.includes(m) ? acc : toggleMarker(acc, m)), []);

function requireZip() {
  if (!window.JSZip) throw new Error('ZIP-Bibliothek nicht geladen – Internetverbindung prüfen');
  return window.JSZip;
}

export async function fromXmind(buf) {
  const zip = await requireZip().loadAsync(buf);
  const cj = zip.file('content.json');
  if (cj) return JSON.parse(await cj.async('string')).map(sheetFromJson);
  const cx = zip.file('content.xml');
  if (cx) return sheetsFromXml(await cx.async('string'));
  throw new Error('Keine XMind-Inhalte gefunden');
}

function sheetFromJson(sheet) {
  const idMap = new Map();
  const conv = t => {
    const n = topic(t.title ?? '');
    idMap.set(t.id, n.id);
    n.note = t.notes?.plain?.content || '';
    n.labels = Array.isArray(t.labels) ? t.labels : [];
    n.link = t.href && !String(t.href).startsWith('xmind:') ? t.href : '';
    n.markers = cleanMarkers((t.markers || []).map(m => markerFromX(m.markerId)));
    n.collapsed = t.branch === 'folded';
    n.children = (t.children?.attached || []).map(conv);
    return n;
  };
  const root = conv(sheet.rootTopic || {});
  const d = newDoc(sheet.title || root.text || 'XMind-Import', root, structFromXmind(sheet.rootTopic?.structureClass));
  d.relations = (sheet.relationships || [])
    .map(r => ({ id: uid(), from: idMap.get(r.end1Id), to: idMap.get(r.end2Id), label: r.title || '' }))
    .filter(r => r.from && r.to);
  return d;
}

function sheetsFromXml(text) {
  const x = new DOMParser().parseFromString(text, 'text/xml');
  const kids = (el, tag) => [...el.children].filter(c => c.localName === tag);
  const conv = el => {
    const n = topic(kids(el, 'title')[0]?.textContent || '');
    const notes = kids(el, 'notes')[0];
    if (notes) n.note = kids(notes, 'plain')[0]?.textContent || '';
    const ch = kids(el, 'children')[0];
    if (ch) for (const ts of kids(ch, 'topics')) if ((ts.getAttribute('type') || 'attached') === 'attached') n.children.push(...kids(ts, 'topic').map(conv));
    if (el.getAttribute('branch') === 'folded') n.collapsed = true;
    const mr = kids(el, 'marker-refs')[0];
    if (mr) n.markers = cleanMarkers(kids(mr, 'marker-ref').map(m => markerFromX(m.getAttribute('marker-id'))));
    const lb = kids(el, 'labels')[0];
    if (lb) n.labels = kids(lb, 'label').map(l => l.textContent);
    const href = el.getAttribute('xlink:href') || el.getAttribute('href');
    if (href && !href.startsWith('xmind:')) n.link = href;
    return n;
  };
  const sheets = [...x.getElementsByTagName('*')].filter(e => e.localName === 'sheet');
  if (!sheets.length) throw new Error('Keine Blätter in content.xml');
  return sheets.map(sh => {
    const rt = kids(sh, 'topic')[0];
    const root = conv(rt);
    return newDoc(kids(sh, 'title')[0]?.textContent || root.text, root, structFromXmind(rt.getAttribute('structure-class') || ''));
  });
}

export async function toXmind(doc) {
  const JSZip = requireZip();
  const conv = n => {
    const t = { id: n.id, class: 'topic', title: n.text };
    if (n.note) t.notes = { plain: { content: n.note } };
    if (n.labels.length) t.labels = n.labels;
    const mk = n.markers.map(markerToX).filter(Boolean).map(markerId => ({ markerId }));
    if (mk.length) t.markers = mk;
    if (n.link) t.href = n.link;
    if (n.collapsed) t.branch = 'folded';
    if (n.children.length) t.children = { attached: n.children.map(conv) };
    return t;
  };
  const rootTopic = conv(doc.root);
  rootTopic.structureClass = XM_STRUCT[doc.structure] || XM_STRUCT.mindmap;
  const sheet = { id: uid(), class: 'sheet', title: doc.title, rootTopic };
  if (doc.relations.length) sheet.relationships = doc.relations.map(r => ({ id: r.id, end1Id: r.from, end2Id: r.to, ...(r.label ? { title: r.label } : {}) }));
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([sheet]));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'Mindwerk', version: '1.0.0' } }));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.xmind.workbook' });
}

// ---------- Import-Dispatcher ----------
export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'xmind') return fromXmind(await file.arrayBuffer());
  const text = await file.text();
  if (ext === 'json') return [fromJSON(text)];
  if (ext === 'opml' || ext === 'xml') return [fromOPML(text)];
  return [fromMarkdown(text, base)];
}

// ---------- SVG / PNG ----------
let _ctx;
function wrap(text, font, maxW) {
  const c = (_ctx ||= document.createElement('canvas').getContext('2d'));
  c.font = font;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      const test = line + w;
      if (c.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

export function markersText(markers) {
  return markers.map(m => {
    if (/^p\d$/.test(m)) return '①②③④⑤⑥'[+m.slice(1) - 1] || '';
    const i = ['t0', 't25', 't50', 't75', 't100'].indexOf(m);
    if (i >= 0) return '○◔◑◕●'[i];
    return SYMBOLS[m] || '';
  }).join(' ');
}

export function toSVG({ nodes, edges, relations, bounds, bg, text, relColor, pad = 40 }) {
  const x0 = bounds.minX - pad, y0 = bounds.minY - pad;
  const w = Math.ceil(bounds.maxX - bounds.minX + pad * 2), h = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}" font-family="${esc(TOPIC_FONT)}">`);
  p.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${relColor}"/></marker></defs>`);
  p.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${bg}"/>`);
  for (const e of edges) p.push(`<path d="${e.d}" fill="none" stroke="${e.color}" stroke-width="${e.width}" stroke-linecap="round"/>`);
  for (const n of nodes) {
    const st = styleFor(n.depth);
    const stroke = n.border && n.border !== 'transparent' ? ` stroke="${n.border}" stroke-width="1.5"` : '';
    p.push(`<rect x="${n.x + 0.75}" y="${n.y + 0.75}" width="${n.w - 1.5}" height="${n.h - 1.5}" rx="${st.radius}" fill="${n.fill}"${stroke}/>`);
    const font = `${st.weight} ${st.size}px ${TOPIC_FONT}`;
    const mk = markersText(n.markers);
    const icons = (n.note ? ' 📝' : '') + (n.link ? ' 🔗' : '');
    const lines = wrap((mk ? mk + ' ' : '') + (n.text || ' ') + icons, font, n.w - st.px * 2 + 12);
    const lh = st.size * st.lh;
    const labelH = n.labels.length ? 22 : 0;
    const startY = n.y + (n.h - labelH - lines.length * lh) / 2;
    lines.forEach((ln, i) => {
      p.push(`<text x="${n.x + n.w / 2}" y="${startY + i * lh + lh / 2}" text-anchor="middle" dominant-baseline="central" font-size="${st.size}" font-weight="${st.weight}" fill="${n.fg}">${esc(ln)}</text>`);
    });
    if (labelH) p.push(`<text x="${n.x + n.w / 2}" y="${n.y + n.h - st.py - 9}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="500" fill="${n.fg}" opacity="0.8">${esc(n.labels.join('  ·  '))}</text>`);
  }
  for (const r of relations) {
    p.push(`<path d="${r.d}" fill="none" stroke="${relColor}" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#arr)"/>`);
    if (r.label) p.push(`<text x="${r.lx}" y="${r.ly}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="500" fill="${text}" stroke="${bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(r.label)}</text>`);
  }
  p.push('</svg>');
  return { svg: p.join('\n'), w, h };
}

export function svgToPng(svg, w, h) {
  const scale = Math.max(0.25, Math.min(2, 16000 / w, 16000 / h));
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG konnte nicht gerendert werden')); };
    img.src = url;
  });
}
