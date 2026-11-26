/* ============ EXITS ============
   An exit is a strip of EXIT tiles in the border. Walking onto it warps you to another room.
   edge: 0 top, 1 bottom, 2 left, 3 right.  start: first tile along that edge. */
function doorCell(e, i) {
  switch (e.edge) { case 0: return [e.start + i, 0]; case 1: return [e.start + i, ROWS - 1];
                    case 2: return [0, e.start + i]; default: return [COLS - 1, e.start + i]; }
}
function inCell(e, i, d) {           // tile i along the exit, d tiles inward
  switch (e.edge) { case 0: return [e.start + i, d]; case 1: return [e.start + i, ROWS - 1 - d];
                    case 2: return [d, e.start + i]; default: return [COLS - 1 - d, e.start + i]; }
}
function spawnPos(e) {               // where you appear when arriving through this exit
  const c = e.start + DOOR / 2, d = 2.5; let tx, ty;
  switch (e.edge) { case 0: tx = c; ty = d; break; case 1: tx = c; ty = ROWS - d; break;
                    case 2: tx = d; ty = c; break; default: tx = COLS - d; ty = c; }
  return { x: tx * TILE, y: ty * TILE + HIT.h / 2 };
}
/* Each wall belongs to a direction. A room has 2 to 4 exits, never more than one per wall.
   Leaving through the north wall puts you at the SOUTH exit of the next room (and so on), at the same position along the wall.
   'back' = { edge, start }: the exit that must exist because it leads back to the room we came from. */
const DIRS = ['north', 'south', 'west', 'east'];       // index = edge: 0 top, 1 bottom, 2 left, 3 right
const OPPOSITE = [1, 0, 3, 2];
function placeExits(rng, back = null) {
  const n = 2 + Math.floor(rng() * 3), walls = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [walls[i], walls[j]] = [walls[j], walls[i]]; }
  const chosen = (back ? [back.edge, ...walls.filter(w => w !== back.edge)] : walls).slice(0, n);
  return chosen.map(edge => {
    const len = edge < 2 ? COLS : ROWS, lo = EXIT_MARGIN, hi = len - EXIT_MARGIN - DOOR;
    const start = back && edge === back.edge ? back.start : lo + Math.floor(rng() * (hi - lo + 1));
    return { edge, dir: DIRS[edge], start, to: null, toExit: 0 };
  }).sort((x, y) => x.edge - y.edge);                  // exits are listed north, south, west, east
}


/* ============ SHARED TOOLS ============ */
function label(g) {                  // connected components of FULL tiles ("isles")
  const lab = new Uint16Array(COLS * ROWS), sizes = [0]; let n = 0;
  for (let s = 0; s < g.length; s++) {
    if (g[s] !== FULL || lab[s]) continue;
    n++; let size = 0; const st = [s]; lab[s] = n;
    while (st.length) {
      const c = st.pop(); size++; const x = c % COLS, y = (c / COLS) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue;
        const ni = idx(nx, ny); if (g[ni] === FULL && !lab[ni]) { lab[ni] = n; st.push(ni); }
      }
    }
    sizes[n] = size;
  }
  return { lab, sizes };
}
/* Connectivity for a character at least 2 tiles wide (the hitbox needs more than one tile of height).
   A "window" is a 2x2 block of walkable tiles; the walker slides it around. Slits 1 tile wide are NOT connections. */
const wideOk = (g, x, y) => x >= 0 && y >= 0 && x + 1 < COLS && y + 1 < ROWS &&
  g[idx(x, y)] !== FULL && g[idx(x + 1, y)] !== FULL && g[idx(x, y + 1)] !== FULL && g[idx(x + 1, y + 1)] !== FULL;
function wideFlood(g, sx, sy, visited) {   // tiles reachable from the window at (sx, sy); 'visited' lets callers walk every region
  const seen = new Uint8Array(COLS * ROWS), vis = visited || new Uint8Array(COLS * ROWS);
  if (!wideOk(g, sx, sy)) return { seen, size: 0, x: sx, y: sy };
  const st = [idx(sx, sy)]; vis[st[0]] = 1; let size = 0;
  while (st.length) {
    const c = st.pop(), x = c % COLS, y = (c / COLS) | 0; size++;
    seen[c] = seen[c + 1] = seen[c + COLS] = seen[c + COLS + 1] = 1;
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = idx(nx, ny); if (!vis[ni] && wideOk(g, nx, ny)) { vis[ni] = 1; st.push(ni); }
    }
  }
  return { seen, size, x: sx, y: sy };
}
function mainRegion(g) {                   // the biggest area a 2-tile-wide walker can move around in = the street network
  const vis = new Uint8Array(COLS * ROWS); let best = null;
  for (let y = 0; y < ROWS - 1; y++) for (let x = 0; x < COLS - 1; x++) {
    if (vis[idx(x, y)] || !wideOk(g, x, y)) continue;
    const r = wideFlood(g, x, y, vis); if (!best || r.size > best.size) best = r;
  }
  return best;
}
function spread(g, seed) {                 // every walkable tile 4-connected to the seed tiles (1-wide dead ends included)
  const seen = Uint8Array.from(seed), st = [];
  for (let i = 0; i < seen.length; i++) if (seen[i]) st.push(i);
  while (st.length) {
    const c = st.pop(), x = c % COLS, y = (c / COLS) | 0;
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue;
      const ni = idx(nx, ny); if (!seen[ni] && g[ni] !== FULL) { seen[ni] = 1; st.push(ni); }
    }
  }
  return seen;
}
function carveTo(g, seen, sx, sy) {        // carve a 2-wide path from (sx,sy) to the nearest tile of 'seen'
  const par = new Int32Array(COLS * ROWS).fill(-2), q = [idx(sx, sy)]; par[q[0]] = -1; let found = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]; if (seen[c]) { found = c; break; }
    const x = c % COLS, y = (c / COLS) | 0;
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= COLS - 1 || ny >= ROWS - 1) continue;
      const ni = idx(nx, ny); if (par[ni] !== -2) continue; par[ni] = c; q.push(ni);
    }
  }
  if (found < 0) return;
  const open = (x, y) => { if (x >= 1 && y >= 1 && x < COLS - 1 && y < ROWS - 1) g[idx(x, y)] = EMPTY; };
  for (let c = found; c !== -1; c = par[c]) {
    const x = c % COLS, y = (c / COLS) | 0;
    open(x, y); open(x + 1, y); open(x, y + 1); open(x + 1, y + 1);
  }
  const fx = found % COLS, fy = (found / COLS) | 0;   // widen the junction so the 2x2 walker can really pass
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) open(fx + dx, fy + dy);
}

/* Runs after ANY generator: stamps exits, makes every exit reachable from every other,
   fills closed-off pockets, labels isles (for texturing later). Streets may still dead-end. */
function finalize(room) {
  const g = room.grid, ex = room.exits;
  for (const e of ex) for (let i = 0; i < DOOR; i++) {
    const [dx, dy] = doorCell(e, i); g[idx(dx, dy)] = EXIT;
    for (let d = 1; d <= EXIT_DEPTH; d++) { const [x, y] = inCell(e, i, d); g[idx(x, y)] = EMPTY; }   // clear approach in front of the exit
  }
  const st = e => inCell(e, DOOR >> 1, 2);
  let main = mainRegion(g);                                    // the street network
  for (const e of ex) {                                        // every exit must be connected to it, for a 2-wide walker
    for (let tries = 0; tries < 4; tries++) {
      const [x, y] = st(e); if (main.seen[idx(x, y)]) break;
      carveTo(g, main.seen, x, y); main = wideFlood(g, main.x, main.y);
    }
  }
  const reached = spread(g, main.seen);
  for (let i = 0; i < g.length; i++) if (g[i] !== FULL && !reached[i]) g[i] = FULL;   // closed pockets
  room.lab = label(g).lab;
  room.exitAt = new Map();
  ex.forEach((e, k) => { for (let i = 0; i < DOOR; i++) { const [x, y] = doorCell(e, i); room.exitAt.set(idx(x, y), k); } });
}


/* ============ CITY GENERATOR ============
   1. street lane around the edge  2. scatter block centers (min distance apart)
   3. every tile goes to its nearest center; tiles close to a block boundary become street
      (this gives wide, irregular, diagonal streets)
   4. some neighbor blocks merge (no street between them = big/stacked buildings), some become plazas
   5. chamfer corners for variety, delete tiny leftover isles */
function genCity(rng) {
  const g = new Uint8Array(COLS * ROWS).fill(FULL);
  const minD = 12 + rng() * 2, half = 1.5 + rng() * 0.6;     // block spacing; half street width
  const lo = EDGE_LANE + 3, pts = [];
  for (let t = 0; t < 600 && pts.length < 80; t++) {
    const x = lo + rng() * (COLS - 2 * lo), y = lo + rng() * (ROWS - 2 * lo);
    if (pts.every(q => Math.hypot(q.x - x, q.y - y) >= minD)) pts.push({ x, y });
  }
  const par = pts.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < minD * 1.6 && rng() < 0.4) par[find(i)] = find(j);
  const root = pts.map((_, i) => find(i)), plaza = new Set();
  for (let i = 0; i < pts.length; i++) if (root[i] === i && rng() < 0.12) plaza.add(i);

  const ds = new Float64Array(pts.length);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const m = Math.min(x, y, COLS - 1 - x, ROWS - 1 - y);
    if (m === 0) continue;                                   // border stays full
    if (m <= EDGE_LANE) { g[idx(x, y)] = EMPTY; continue; }  // edge street lane (none when EDGE_LANE = 0)
    let d1 = Infinity, a = 0;
    for (let k = 0; k < pts.length; k++) {
      ds[k] = Math.hypot(pts[k].x - (x + .5), pts[k].y - (y + .5));
      if (ds[k] < d1) { d1 = ds[k]; a = k; }
    }
    let dO = Infinity;                                       // nearest block of a DIFFERENT group
    for (let k = 0; k < pts.length; k++) if (root[k] !== root[a] && ds[k] < dO) dO = ds[k];
    const street = (dO - d1) / 2 < half;
    g[idx(x, y)] = (street || plaza.has(root[a])) ? EMPTY : FULL;
  }

  for (let pass = 0; pass < 1; pass++) {                     // chamfer convex corners
    const rm = [];
    for (let y = EDGE_LANE + 1; y < ROWS - EDGE_LANE - 1; y++) for (let x = EDGE_LANE + 1; x < COLS - EDGE_LANE - 1; x++) {
      if (g[idx(x, y)] !== FULL) continue;
      const u = g[idx(x, y - 1)] === EMPTY, d = g[idx(x, y + 1)] === EMPTY;
      const l = g[idx(x - 1, y)] === EMPTY, r = g[idx(x + 1, y)] === EMPTY;
      if (((u && l) || (u && r) || (d && l) || (d && r)) && rng() < 0.5) rm.push(idx(x, y));
    }
    for (const i of rm) g[i] = EMPTY;
  }
  const L = label(g);                                        // drop tiny isles (not the border)
  for (let i = 0; i < g.length; i++)
    if (g[i] === FULL && L.lab[i] !== L.lab[0] && L.sizes[L.lab[i]] < 8) g[i] = EMPTY;
  return g;
}


/* ============ ROOMS (separate stages, linked by warps) ============
   A room id is a number; the room behind the exit of room R on wall `edge` is hash(worldSeed, R, edge), so the
   whole map is deterministic. The new room's exit on the opposite wall leads back to where you came from.
   Rooms are generated once and kept, so layouts stay intact when you come back. */
const rooms = new Map();
function getRoom(id, parent = null, parentExit = 0) {      // parent: the room we came from; parentExit: its exit index
  let r = rooms.get(id); if (r) return r;
  const rng = mulberry32(hash(worldSeed, id));
  const type = 'city';                                       // later: pick type from the rng
  const pe = parent ? parent.exits[parentExit] : null;
  const exits = placeExits(rng, pe ? { edge: OPPOSITE[pe.edge], start: pe.start } : null);
  if (pe) { const back = exits.find(e => e.edge === OPPOSITE[pe.edge]); back.to = parent.id; back.toExit = parentExit; }
  r = { id, type, exits, byDir: Object.fromEntries(exits.map(e => [e.dir, e])), hue: hash(worldSeed, id, 7) % 360, grid: generators[type](rng) };
  finalize(r);
  placeStructures(r, mulberry32(hash(worldSeed, id, 31)));
  rooms.set(id, r); return r;
}
function destination(room, k) {
  const e = room.exits[k];
  if (e.to === null) {
    const cid = hash(worldSeed, room.id, e.edge) || 1;
    const child = getRoom(cid, room, k), back = child.exits.findIndex(x => x.edge === OPPOSITE[e.edge]);
    e.to = cid; e.toExit = Math.max(0, back);
  }
  return { room: getRoom(e.to), exit: e.toExit };
}
