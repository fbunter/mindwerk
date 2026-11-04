// Datenmodell, Persistenz (localStorage), Vorlagen, Themes und Marker.

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function topic(text = 'Thema', children = []) {
  return { id: uid(), text, children, collapsed: false, note: '', link: '', labels: [], markers: [], color: null };
}

const T = (text, kids = []) => topic(text, kids.map(k => (typeof k === 'string' ? topic(k) : k)));

export function newDoc(title = 'Neue Mindmap', root, structure = 'mindmap', theme = 'klassisch') {
  return {
    id: uid(), title, structure, theme,
    root: root || T('Zentrales Thema'),
    relations: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function normalizeNode(n = {}) {
  return {
    id: n.id || uid(),
    text: n.text ?? '',
    children: (n.children || []).map(normalizeNode),
    collapsed: !!n.collapsed,
    note: n.note || '',
    link: n.link || '',
    labels: Array.isArray(n.labels) ? n.labels.map(String) : [],
    markers: Array.isArray(n.markers) ? n.markers.map(String) : [],
    color: n.color || null,
  };
}

export function normalizeDoc(d = {}) {
  const base = newDoc();
  const doc = { ...base, ...d };
  doc.root = normalizeNode(d.root || topic('Zentrales Thema'));
  doc.relations = Array.isArray(d.relations)
    ? d.relations.filter(r => r && r.from && r.to).map(r => ({ id: r.id || uid(), from: r.from, to: r.to, label: r.label || '' }))
    : [];
  return doc;
}

// ---------- Baum-Helfer ----------
// fn darf false zurückgeben, um die Kinder des Knotens zu überspringen.
export function walk(node, fn, parent = null, depth = 0) {
  if (fn(node, parent, depth) === false) return;
  for (const c of node.children) walk(c, fn, node, depth + 1);
}
export function find(root, id) {
  if (!id) return null;
  let hit = null;
  walk(root, n => { if (hit) return false; if (n.id === id) { hit = n; return false; } });
  return hit;
}
export function parentOf(root, id) {
  let hit = null;
  walk(root, n => { if (hit) return false; if (n.children.some(c => c.id === id)) hit = n; });
  return hit;
}
export function pathTo(root, id) {
  const path = [];
  const rec = n => { path.push(n); if (n.id === id) return true; for (const c of n.children) if (rec(c)) return true; path.pop(); return false; };
  return rec(root) ? path : [];
}
export function contains(node, id) {
  let f = false;
  walk(node, n => { if (f) return false; if (n.id === id) f = true; });
  return f;
}
export function cloneFresh(n) {
  return { ...n, id: uid(), labels: [...n.labels], markers: [...n.markers], children: n.children.map(cloneFresh) };
}
export function count(root) { let c = 0; walk(root, () => { c++; }); return c; }

// ---------- Marker ----------
export const PRIORITY_COLORS = ['#e5484d', '#f76b15', '#e2a106', '#30a46c', '#0091ff', '#8e4ec6'];
export const PROGRESS = ['t0', 't25', 't50', 't75', 't100'];
export const SYMBOLS = {
  star: '⭐', flag: '🚩', idea: '💡', warn: '⚠️', question: '❓', ok: '✅', no: '❌',
  heart: '❤️', up: '👍', down: '👎', fire: '🔥', date: '📅', person: '👤', money: '💰',
};
const markerRank = m => (/^p\d$/.test(m) ? 0 : /^t\d+$/.test(m) ? 1 : 2);
export function toggleMarker(list, id) {
  const has = list.includes(id);
  let out = list.filter(m => m !== id);
  if (!has) {
    if (/^p\d$/.test(id)) out = out.filter(m => !/^p\d$/.test(m));
    if (/^t\d+$/.test(id)) out = out.filter(m => !/^t\d+$/.test(m));
    out.push(id);
  }
  return out.sort((a, b) => markerRank(a) - markerRank(b));
}

// ---------- Themes ----------
export const THEMES = {
  klassisch: {
    name: 'Klassisch', bg: '#f6f7f9', dot: '#e2e5ea', rootBg: '#1e2330', rootFg: '#ffffff', text: '#1e2330', subBg: '#ffffff', rel: '#8b8fa3',
    palette: ['#e5484d', '#f76b15', '#e2a106', '#30a46c', '#0091ff', '#8e4ec6', '#d6409f', '#12a594'],
  },
  pastell: {
    name: 'Pastell', bg: '#fbf8f3', dot: '#ece6dc', rootBg: '#5b5bd6', rootFg: '#ffffff', text: '#2d2a32', subBg: '#fffdf9', rel: '#9a90a8',
    palette: ['#f4a7b9', '#f9c784', '#a8d8b9', '#9cc5f0', '#c5b3f0', '#f7d794'],
  },
  nacht: {
    name: 'Nacht', bg: '#11131a', dot: '#1f2330', rootBg: '#f1f5f9', rootFg: '#11131a', text: '#e6e8ee', subBg: '#1a1e29', rel: '#7c8296',
    palette: ['#ff5c8a', '#ffb347', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'],
  },
  ozean: {
    name: 'Ozean', bg: '#f2f7fb', dot: '#dde8f1', rootBg: '#0e3a5b', rootFg: '#ffffff', text: '#12324a', subBg: '#ffffff', rel: '#7d97ab',
    palette: ['#1d6fa5', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#457b9d'],
  },
  signal: {
    name: 'Signal', bg: '#ffffff', dot: '#ececec', rootBg: '#111111', rootFg: '#ffffff', text: '#111111', subBg: '#ffffff', rel: '#999999',
    palette: ['#e71837', '#111111', '#f4025e', '#555555'],
  },
  mono: {
    name: 'Mono', bg: '#ffffff', dot: '#eeeeee', rootBg: '#111111', rootFg: '#ffffff', text: '#111111', subBg: '#ffffff', rel: '#9a9a9a',
    palette: ['#2b2b2b', '#4a4a4a', '#666666', '#7f7f7f'],
  },
};

// ---------- Vorlagen ----------
export const TEMPLATES = [
  { id: 'blank', name: 'Leere Mindmap', desc: 'Zentrales Thema mit vier Ästen', structure: 'mindmap',
    build: () => newDoc('Neue Mindmap', T('Zentrales Thema', ['Hauptthema 1', 'Hauptthema 2', 'Hauptthema 3', 'Hauptthema 4'])) },
  { id: 'project', name: 'Projektplan', desc: 'Ziele, Team, Meilensteine, Risiken', structure: 'logic',
    build: () => newDoc('Projektplan', T('Projekt', [
      T('Ziele', ['Ziel 1', 'Ziel 2']), T('Team', ['Projektleitung', 'Mitglieder']),
      T('Meilensteine', ['Kick-off', 'Umsetzung', 'Abschluss']), T('Risiken', ['Risiko 1']), T('Budget'),
    ]), 'logic') },
  { id: 'meeting', name: 'Meeting-Notizen', desc: 'Agenda, Entscheidungen, Aufgaben', structure: 'mindmap',
    build: () => newDoc('Meeting', T('Meeting', [
      T('Agenda', ['Punkt 1', 'Punkt 2']), T('Teilnehmende'), T('Entscheidungen'),
      T('Aufgaben', ['Wer? Was? Bis wann?']), T('Nächste Schritte'),
    ])) },
  { id: 'swot', name: 'SWOT-Analyse', desc: 'Stärken, Schwächen, Chancen, Risiken', structure: 'mindmap',
    build: () => newDoc('SWOT-Analyse', T('SWOT', [
      T('Stärken', ['…']), T('Schwächen', ['…']), T('Chancen', ['…']), T('Risiken', ['…']),
    ])) },
  { id: 'org', name: 'Organigramm', desc: 'Hierarchie von oben nach unten', structure: 'org',
    build: () => newDoc('Organigramm', T('Geschäftsführung', [
      T('Vertrieb', ['Team Nord', 'Team Süd']), T('Marketing', ['Content', 'Performance']), T('Technik', ['Entwicklung', 'Support']),
    ]), 'org') },
  { id: 'timeline', name: 'Zeitstrahl', desc: 'Phasen oder Quartale nebeneinander', structure: 'timeline',
    build: () => newDoc('Roadmap', T('Roadmap 2027', [
      T('Q1', ['Recherche', 'Interviews']), T('Q2', ['Prototyp']), T('Q3', ['Pilot']), T('Q4', ['Launch']),
    ]), 'timeline') },
];

export function welcomeDoc() {
  const d = newDoc('Willkommen bei Mindwerk', T('Mindwerk', [
    T('Loslegen', ['Doppelklick / F2: Text bearbeiten', 'Tab: Unterthema', 'Enter: Gleichrangiges Thema', 'Entf: Thema löschen', 'Pfeiltasten: Navigieren']),
    T('Strukturen', ['Mindmap', 'Logikdiagramm', 'Organigramm', 'Baumdiagramm', 'Zeitstrahl']),
    T('Extras', ['Notizen, Labels & Marker', 'Beziehungslinien', 'Gliederungsansicht', 'Präsentationsmodus']),
    T('Import & Export', ['XMind (.xmind)', 'Markdown & OPML', 'PNG & SVG']),
  ]));
  const [a, b, c, e] = d.root.children;
  a.markers = ['p1'];
  b.markers = ['star'];
  c.children[0].labels = ['Tipp'];
  c.children[0].note = 'Notizen, Links, Labels und Marker bearbeitest du rechts im Format-Panel.';
  e.markers = ['t75'];
  d.relations.push({ id: uid(), from: c.children[1].id, to: b.id, label: 'verbindet' });
  return d;
}

// ---------- Speicherung ----------
const IDX = 'mindwerk:index', DOC = 'mindwerk:doc:', LAST = 'mindwerk:last';
const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };

export const storage = {
  list: () => safe(() => JSON.parse(localStorage.getItem(IDX) || '[]'), []),
  load: id => safe(() => { const s = localStorage.getItem(DOC + id); return s ? normalizeDoc(JSON.parse(s)) : null; }, null),
  save(doc) {
    doc.updatedAt = Date.now();
    safe(() => {
      localStorage.setItem(DOC + doc.id, JSON.stringify(doc));
      const idx = storage.list().filter(e => e.id !== doc.id);
      idx.unshift({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt });
      localStorage.setItem(IDX, JSON.stringify(idx));
      localStorage.setItem(LAST, doc.id);
    });
  },
  remove(id) {
    safe(() => {
      localStorage.removeItem(DOC + id);
      localStorage.setItem(IDX, JSON.stringify(storage.list().filter(e => e.id !== id)));
    });
  },
  last: () => safe(() => localStorage.getItem(LAST), null),
  setLast: id => safe(() => localStorage.setItem(LAST, id)),
};
