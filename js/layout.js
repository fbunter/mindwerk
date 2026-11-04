// Layout-Engine: berechnet Positionen aller sichtbaren Themen und die Verbindungslinien.

export const STRUCTURES = {
  mindmap: { name: 'Mindmap' },
  logic: { name: 'Logikdiagramm' },
  org: { name: 'Organigramm' },
  tree: { name: 'Baumdiagramm' },
  timeline: { name: 'Zeitstrahl' },
};

export function computeLayout(root, sizeOf, structure = 'mindmap') {
  const pos = new Map();
  const edges = [];
  const kids = n => (n.collapsed ? [] : n.children);
  const set = (n, x, y, depth, dir = 1) => {
    const s = sizeOf(n.id);
    const p = { x, y, w: s.w, h: s.h, depth, dir };
    pos.set(n.id, p);
    return p;
  };

  // --- horizontale Bäume (Mindmap / Logik) ---
  const hgap = d => (d === 0 ? 56 : 34);
  const vgap = d => (d === 0 ? 20 : 10);
  const hMemo = new Map();
  const bh = (n, d) => {
    if (hMemo.has(n.id)) return hMemo.get(n.id);
    const k = kids(n);
    let sum = 0;
    for (const c of k) sum += bh(c, d + 1);
    const v = Math.max(sizeOf(n.id).h, sum + vgap(d) * Math.max(0, k.length - 1));
    hMemo.set(n.id, v);
    return v;
  };
  const hKids = (n, list, d, dir, kind) => {
    if (!list.length) return;
    const p = pos.get(n.id);
    const g = vgap(d);
    const total = list.reduce((a, c) => a + bh(c, d + 1), 0) + g * (list.length - 1);
    let y = p.y + p.h / 2 - total / 2;
    const nx = dir > 0 ? p.x + p.w + hgap(d) : p.x - hgap(d);
    for (const c of list) {
      const h = bh(c, d + 1);
      const s = sizeOf(c.id);
      set(c, dir > 0 ? nx : nx - s.w, y + h / 2 - s.h / 2, d + 1, dir);
      edges.push({ from: n.id, to: c.id, kind, dir, depth: d + 1 });
      hKids(c, kids(c), d + 1, dir, kind);
      y += h + g;
    }
  };

  // --- eingerückte Liste (Baum / Zeitstrahl) ---
  const IND = 28, TV = 9;
  let maxR = -Infinity;
  const lPlace = (n, x, y, d) => {
    const p = set(n, x, y, d, 1);
    maxR = Math.max(maxR, x + p.w);
    let bottom = y + p.h;
    for (const c of kids(n)) {
      edges.push({ from: n.id, to: c.id, kind: 'tree', depth: d + 1 });
      bottom = lPlace(c, x + IND, bottom + TV, d + 1);
    }
    return bottom;
  };

  switch (structure) {
    case 'logic': {
      const s = sizeOf(root.id);
      set(root, 0, -s.h / 2, 0, 1);
      hKids(root, kids(root), 0, 1, 'elbow');
      break;
    }
    case 'org': {
      const OG = 18, OV = 44;
      const LI = 22;
      // Reine Blatt-Gruppen (ab Ebene 1) werden platzsparend untereinander gestapelt.
      const isList = (n, d) => d >= 1 && kids(n).length >= 2 && kids(n).every(c => !kids(c).length);
      const rowH = [];
      const measure = (n, d) => {
        rowH[d] = Math.max(rowH[d] || 0, sizeOf(n.id).h);
        if (!isList(n, d)) kids(n).forEach(c => measure(c, d + 1));
      };
      measure(root, 0);
      const rowY = [0];
      for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + OV;
      const wMemo = new Map();
      const bw = (n, d) => {
        if (wMemo.has(n.id)) return wMemo.get(n.id);
        const k = kids(n);
        const v = isList(n, d)
          ? Math.max(sizeOf(n.id).w, LI + Math.max(...k.map(c => sizeOf(c.id).w)))
          : Math.max(sizeOf(n.id).w, k.reduce((a, c) => a + bw(c, d + 1), 0) + OG * Math.max(0, k.length - 1));
        wMemo.set(n.id, v);
        return v;
      };
      const place = (n, xc, d) => {
        const s = sizeOf(n.id);
        const left = isList(n, d) ? xc - bw(n, d) / 2 : xc - s.w / 2;
        set(n, left, rowY[d], d, 0);
        const list = kids(n);
        if (!list.length) return;
        if (isList(n, d)) {
          let y = rowY[d] + s.h + 12;
          for (const c of list) {
            const cs = sizeOf(c.id);
            set(c, left + LI, y, d + 1, 0);
            edges.push({ from: n.id, to: c.id, kind: 'tree', depth: d + 1 });
            y += cs.h + 8;
          }
          return;
        }
        const total = list.reduce((a, c) => a + bw(c, d + 1), 0) + OG * (list.length - 1);
        let x = xc - total / 2;
        for (const c of list) {
          const w = bw(c, d + 1);
          place(c, x + w / 2, d + 1);
          edges.push({ from: n.id, to: c.id, kind: 'org', depth: d + 1, my: rowY[d + 1] - OV / 2 });
          x += w + OG;
        }
      };
      place(root, 0, 0);
      break;
    }
    case 'tree':
      lPlace(root, 0, 0, 0);
      break;
    case 'timeline': {
      const rs = sizeOf(root.id);
      set(root, 0, -rs.h / 2, 0, 1);
      let x = rs.w + 48, prev = root.id;
      for (const c of kids(root)) {
        const cs = sizeOf(c.id);
        const p = set(c, x, -cs.h / 2, 1, 1);
        edges.push({ from: prev, to: c.id, kind: 'axis', depth: 1 });
        maxR = x + cs.w;
        let bottom = p.y + p.h;
        for (const g of kids(c)) {
          edges.push({ from: c.id, to: g.id, kind: 'tree', depth: 2 });
          bottom = lPlace(g, x + IND, bottom + TV, 2);
        }
        x = maxR + 48;
        prev = c.id;
      }
      break;
    }
    default: { // mindmap: Äste rechts im Uhrzeigersinn, dann links
      const s = sizeOf(root.id);
      set(root, -s.w / 2, -s.h / 2, 0, 0);
      const list = kids(root);
      const hs = list.map(c => bh(c, 1));
      const tot = hs.reduce((a, b) => a + b, 0);
      let best = Math.ceil(list.length / 2), bestDiff = Infinity, acc = 0;
      for (let k = 1; k <= list.length; k++) {
        acc += hs[k - 1];
        const diff = Math.abs(acc - (tot - acc));
        if (diff <= bestDiff) { bestDiff = diff; best = k; }
        else break;
      }
      hKids(root, list.slice(0, best), 0, 1, 'curve');
      hKids(root, list.slice(best).reverse(), 0, -1, 'curve');
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
  }
  return { pos, edges, bounds: { minX, minY, maxX, maxY } };
}

export function edgePath(e, pos) {
  const a = pos.get(e.from), b = pos.get(e.to);
  if (!a || !b) return '';
  switch (e.kind) {
    case 'curve': {
      const px = e.dir > 0 ? a.x + a.w : a.x, py = a.y + a.h / 2;
      const cx = e.dir > 0 ? b.x : b.x + b.w, cy = b.y + b.h / 2;
      const mx = (px + cx) / 2;
      return `M${px},${py} C${mx},${py} ${mx},${cy} ${cx},${cy}`;
    }
    case 'elbow': {
      const px = a.x + a.w, py = a.y + a.h / 2, cx = b.x, cy = b.y + b.h / 2;
      const mx = px + Math.min(20, (cx - px) / 2);
      const dy = cy - py;
      if (Math.abs(dy) < 1) return `M${px},${py} H${cx}`;
      const s = Math.sign(dy), r = Math.min(8, Math.abs(dy) / 2, cx - mx);
      return `M${px},${py} H${mx} V${cy - s * r} Q${mx},${cy} ${mx + r},${cy} H${cx}`;
    }
    case 'org': {
      const px = a.x + a.w / 2, py = a.y + a.h, cx = b.x + b.w / 2, cy = b.y;
      const my = e.my ?? (py + cy) / 2;
      const dx = cx - px;
      if (Math.abs(dx) < 1) return `M${px},${py} V${cy}`;
      const s = Math.sign(dx), r = Math.min(8, Math.abs(dx) / 2, cy - my);
      return `M${px},${py} V${my} H${cx - s * r} Q${cx},${my} ${cx},${my + r} V${cy}`;
    }
    case 'tree': {
      const px = a.x + 14, py = a.y + a.h, cx = b.x, cy = b.y + b.h / 2;
      const r = Math.max(0, Math.min(8, cy - py, cx - px));
      return `M${px},${py} V${cy - r} Q${px},${cy} ${px + r},${cy} H${cx}`;
    }
    case 'axis': {
      const px = a.x + a.w, py = a.y + a.h / 2, cx = b.x, cy = b.y + b.h / 2;
      return `M${px},${py} L${cx},${cy}`;
    }
  }
  return '';
}

function boxEdge(r, t) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = t.x - cx, dy = t.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (r.w / 2 + 4) / Math.abs(dx) : Infinity;
  const sy = dy ? (r.h / 2 + 4) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function relationPath(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(120, len * 0.3);
  const c = { x: (ac.x + bc.x) / 2 - (dy / len) * off, y: (ac.y + bc.y) / 2 + (dx / len) * off };
  const s = boxEdge(a, c), e = boxEdge(b, c);
  return {
    d: `M${s.x},${s.y} Q${c.x},${c.y} ${e.x},${e.y}`,
    label: { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y },
  };
}

const R = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="currentColor"/>`;
const P = d => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
export const STRUCT_ICONS = {
  mindmap: `<svg viewBox="0 0 64 40">${R(24, 16, 16, 8)}${P('M40 20C46 20 46 8 52 8M40 20C46 20 46 32 52 32M24 20C18 20 18 8 12 8M24 20C18 20 18 32 12 32')}${R(52, 5, 10, 6)}${R(52, 29, 10, 6)}${R(2, 5, 10, 6)}${R(2, 29, 10, 6)}</svg>`,
  logic: `<svg viewBox="0 0 64 40">${R(4, 16, 16, 8)}${P('M20 20H28V8H38M28 20H38M28 20V32H38')}${R(38, 5, 14, 6)}${R(38, 17, 14, 6)}${R(38, 29, 14, 6)}</svg>`,
  org: `<svg viewBox="0 0 64 40">${R(24, 4, 16, 8)}${P('M32 12V19M12 19H52M12 19V26M32 19V26M52 19V26')}${R(5, 26, 14, 7)}${R(25, 26, 14, 7)}${R(45, 26, 14, 7)}</svg>`,
  tree: `<svg viewBox="0 0 64 40">${R(10, 3, 18, 7)}${P('M15 10V16H22M15 16V25H22M15 25V34H22')}${R(22, 13, 18, 6)}${R(22, 22, 18, 6)}${R(22, 31, 18, 6)}</svg>`,
  timeline: `<svg viewBox="0 0 64 40">${R(2, 10, 12, 8)}${P('M14 14H60M22 18V28H26M40 18V28H44')}${R(18, 10, 12, 8)}${R(36, 10, 12, 8)}${R(26, 25, 10, 6)}${R(44, 25, 10, 6)}</svg>`,
};
