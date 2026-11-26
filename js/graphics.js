/* ============ ASSET LOCATIONS (static hosting) ============
   Every path here is RELATIVE to the page, so it works on a GitHub Pages project site (https://USER.github.io/REPO/),
   on a local HTTP server, and in any subfolder. Never start a path with "/" (that points at the domain root).
   File names are CASE-SENSITIVE on GitHub Pages: they must match the files in the repo exactly. */
const APP_ID = 'coop-termina';                   // prefix for cache names (all projects of one github.io account share one browser origin)
const STRUCTURES_DIR = 'structures/';            // structure JSON files live here
const STRUCTURE_MANIFEST = 'manifest.json';      // structures/manifest.json = JSON array of the file names to load, e.g. ["structures.json"]
const STRUCTURE_FALLBACK_FILES = ['structures.json'];   // read (with a console warning) if the manifest is missing
const ATLAS_DIR = 'assets/';                     // atlas images live here; a structure's texture.atlas is the exact file name
const ASSET_VERSION = '2';                       // BUMP after changing any atlas or structure file: it renames the caches and is added to atlas URLs (?v=)
const STRUCTURE_CACHE_MINUTES = 10;              // saved structures are reused this long before the files are requested again
const DOT_MUST_BE_EMPTY = false;                  // false: '.' = "not part of the structure", no constraint on the map

/* Caching is ON for visitors and OFF on localhost / file:// (so edits show up immediately while developing).
   ?nocache forces it off, ?usecache forces it on (to test it locally). */
const PARAMS = new URLSearchParams(location.search);
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
const USE_CACHE = !PARAMS.has('nocache') && (PARAMS.has('usecache') || !IS_LOCAL);
const PAGE_BASE = new URL('./', document.baseURI).href;                 // folder of the page, whatever it is called
const assetUrl = path => new URL(path, PAGE_BASE).href;
const safeName = n => typeof n === 'string' && n !== '' && !n.startsWith('/') && !n.includes('..') && !n.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(n);
const encodePath = n => n.split('/').map(encodeURIComponent).join('/');
const ATLAS_CACHE_NAME = `${APP_ID}-atlas-v${ASSET_VERSION}`, STRUCT_CACHE_KEY = `${APP_ID}-structures-v${ASSET_VERSION}`;
const LEGACY_CACHES = ['city-atlas-cache-v1'], LEGACY_KEYS = ['termina-structures-v1'];

let STRUCT_LIST = [], structSource = '', structWarnings = [];

const atlases = {};
const isBorder = (x, y) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;

/* Turns a definition into placeable variants (normal + mirrored). Mirroring flips the footprint,
   the anchor and every texture tile's 'at' across the same vertical axis, and flags tiles to be drawn flipped. */
function compileStructure(def) {
  const rows = def.footprint, tiles = def.texture.tiles, ts = def.texture.tileSize;
  const anchor = def.anchor || [0, 0];
  const W = Math.max(...rows.map(r => r.length), ...tiles.map(t => t.at[0] + 1));
  const H = Math.max(rows.length, ...tiles.map(t => t.at[1] + 1));
  const base = rows.map(r => r.padEnd(W, '.')); while (base.length < H) base.push('.'.repeat(W));
  const mk = m => ({
    id: def.id, atlas: def.texture.atlas, tileSize: ts, flip: m, w: W, h: H,
    fp: m ? base.map(r => [...r].reverse().join('')) : base,
    anchor: m ? [W - 1 - anchor[0], anchor[1]] : [...anchor],
    tiles: tiles.map(t => ({ src: t.src, at: m ? [W - 1 - t.at[0], t.at[1]] : t.at })),
  });
  const occ = new Set(), warn = [];
  base.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#' || ch === 'D') occ.add(x + ',' + y); }));
  const texAt = new Set(tiles.map(t => t.at[0] + ',' + t.at[1]));
  const over = tiles.filter(t => !occ.has(t.at[0] + ',' + t.at[1])).length;
  if (over) warn.push(`${def.id}: ${over} texture tile(s) lie outside the footprint (fine if they are visual overhangs)`);
  for (const k of occ) if (!texAt.has(k)) warn.push(`${def.id}: footprint cell (${k}) has no texture tile`);
  const variants = [mk(false)]; if (def.mirror) variants.push(mk(true));   // note: 'rotation' is not implemented yet
  let baseRow = 0; base.forEach((r, y) => { if (/[#D]/.test(r)) baseRow = y + 1; });   // last occupied row: used to order overlapping structures
  variants.forEach(v => {
    v.baseRow = baseRow;
    const xs = v.tiles.map(t => t.at[0]), ys = v.tiles.map(t => t.at[1]);
    v.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];   // sprite extent in tiles
    const fr = v.fp.findIndex(r => /[#D]/.test(r));                       // first occupied cell in reading order = scan point,
    v.first = [v.fp[fr].search(/[#D]/), fr];                              // so structures with empty top rows aren't favored
  });
  const weight = Number.isFinite(def.weight) ? def.weight : 1;                // missing weight = 1, 0 or less = never placed
  const priority = Number.isFinite(def.priority) ? def.priority : 1;          // pass number: 1 is placed first; missing = 1
  return { id: def.id, area: occ.size, weight, priority, variants, warn };
}

/* ---- Atlas images: Cache API (visitors only) -> network. One download per atlas, decoded once. ---- */
async function openAtlasCache() {
  if (!USE_CACHE || typeof caches === 'undefined') return null;          // Cache API needs https or localhost
  try { return await caches.open(ATLAS_CACHE_NAME); }
  catch (e) { console.warn('[atlas] Cache API unavailable, downloading on every visit:', e.message || e); return null; }
}
async function fetchAtlasBlob(url, skipCache) {
  const cache = await openAtlasCache();
  if (cache && !skipCache) { const hit = await cache.match(url); if (hit) return { blob: await hit.blob(), from: 'cache' }; }
  const res = await fetch(url, { cache: USE_CACHE ? 'default' : 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  const type = res.headers.get('content-type') || '';
  if (type && !/^image\//i.test(type)) throw new Error(`the server sent "${type}", not an image`);
  if (cache) { try { await cache.put(url, res.clone()); } catch (e) { console.warn('[atlas] could not save to cache:', e.message || e); } }
  return { blob: await res.blob(), from: 'network' };
}
function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((res, rej) => {                                    // very old browsers
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('the image could not be decoded')); };
    im.src = u;
  });
}
const atlasJobs = {};
const loadAtlas = name => atlasJobs[name] || (atlasJobs[name] = loadAtlasOnce(name));
async function loadAtlasOnce(name) {
  const a = atlases[name] = { ok: false, img: null, status: 'loading', error: '', url: '' };
  try {
    if (!safeName(name)) throw new Error('the atlas must be a plain file name inside ' + ATLAS_DIR + ' (no leading "/", no "..", no http://)');
    const url = a.url = assetUrl(ATLAS_DIR + encodePath(name)) + '?v=' + encodeURIComponent(ASSET_VERSION);
    let got = await fetchAtlasBlob(url, false);
    try { a.img = await decodeImage(got.blob); }
    catch (e) {
      if (got.from !== 'cache') throw e;
      console.warn(`[atlas] the cached copy of "${name}" is damaged; downloading it again`);
      const cache = await openAtlasCache(); if (cache) await cache.delete(url);
      got = await fetchAtlasBlob(url, true); a.img = await decodeImage(got.blob);
    }
    a.ok = true; a.status = `loaded from ${got.from} (${a.img.width}x${a.img.height}px)`;
  } catch (e) {
    a.error = e.message || String(e); a.status = 'FAILED: ' + a.error;
    console.error(`[atlas] could not load "${name}"${a.url ? ' from ' + a.url : ''}\n  reason: ${a.error}\n` +
      `  check: the file exists as ${ATLAS_DIR}${name} in the repository with exactly this capitalization (GitHub Pages is case-sensitive), and Pages has finished deploying.`);
  }
}
/* "Tile calculations": assembles each variant's tiles into ONE sprite, once, at the atlas' native resolution.
   Drawing a placement is then a single drawImage. Mirrored variants get flipped tiles. */
function buildSprite(v, atlas) {
  const ts = v.tileSize, c = document.createElement('canvas');
  c.width = v.w * ts; c.height = v.h * ts;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  for (const t of v.tiles) {
    const sx = t.src[0] * ts, sy = t.src[1] * ts;
    if (v.flip) { g.save(); g.translate((t.at[0] + 1) * ts, t.at[1] * ts); g.scale(-1, 1); g.drawImage(atlas.img, sx, sy, ts, ts, 0, 0, ts, ts); g.restore(); }
    else g.drawImage(atlas.img, sx, sy, ts, ts, t.at[0] * ts, t.at[1] * ts, ts, ts);
  }
  return c;
}


/* ============ RENDER LOOP ============ */
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
let fatal = null;                                  // set when the game cannot start; drawn instead of the game
function drawFatal() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#240d0d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 22px monospace'; ctx.fillText(fatal.title, 24, 50);
  ctx.fillStyle = '#fff'; ctx.font = '16px monospace'; fatal.lines.forEach((l, i) => ctx.fillText(l, 24, 90 + i * 24));
}
function resize() { canvas.width = innerWidth; canvas.height = innerHeight; if (fatal) drawFatal(); }
addEventListener('resize', resize); resize();

/* ============ CACHED ROOM RENDERING ============
   A room never changes after it is generated, so its look (ground, walls, exits, leftovers and every structure)
   is painted ONCE into an offscreen canvas at NATIVE px per tile. Each frame only copies the visible part of it.
   Only a few canvases exist (reused least-recently-used), so memory stays flat however many rooms you visit. */
const K = TILE / NATIVE;                         // world pixels per background pixel
const BG_SLOTS = 3, bgSlots = []; let bgTick = 0;

function renderBackground(room, c) {
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const N = NATIVE, ground = `hsl(${room.hue},22%,17%)`, haveSprites = STRUCT_LIST.some(s => s.variants[0].sprite);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const i = idx(tx, ty), v = room.grid[i];
    g.fillStyle = v === EXIT ? '#37d6e8'
      : v !== FULL ? ground
      : room.struct[i] ? (haveSprites ? ground : '#7a2f22')       // footprint cell: plain ground under real art
      : isBorder(tx, ty) ? '#3a3a44' : '#4f8fe0';                   // border / leftover filled tile
    g.fillRect(tx * N, ty * N, N, N);
  }
  // back to front: the structure whose last occupied row is lowest on screen is drawn last, so it overlaps the ones behind it
  const order = [...room.placements].sort((a, b) => (a.oy + a.v.baseRow) - (b.oy + b.v.baseRow) || a.ox - b.ox);
  for (const pl of order) {
    const v = pl.v;
    if (v.sprite) { g.drawImage(v.sprite, pl.ox * N, pl.oy * N, v.w * N, v.h * N); continue; }   // mirrored variants have their own sprite
    for (const t of v.tiles) {                                       // no atlas: red squares
      const dx = (pl.ox + t.at[0]) * N, dy = (pl.oy + t.at[1]) * N;
      g.fillStyle = '#d9482f'; g.fillRect(dx, dy, N, N);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(dx + 1, dy + 1, N - 2, N - 2);
    }
  }
}
function getBackground(room) {
  let slot = bgSlots.find(sl => sl.room === room);
  if (!slot) {
    if (bgSlots.length < BG_SLOTS) {
      const canvas = document.createElement('canvas'); canvas.width = COLS * NATIVE; canvas.height = ROWS * NATIVE;
      slot = { canvas, room: null, used: 0 }; bgSlots.push(slot);
    } else slot = bgSlots.reduce((a, b) => a.used <= b.used ? a : b);   // reuse the least recently used canvas
    slot.room = room; renderBackground(room, slot.canvas);
  }
  slot.used = ++bgTick; return slot.canvas;
}

/* Debug overlays (G grid, F footprint) live in their own canvas, rebuilt only when the room or a toggle changes. */
const overlay = { canvas: null, room: null, grid: false, foot: false };
function getOverlay(room) {
  if (!overlay.canvas) { overlay.canvas = document.createElement('canvas'); overlay.canvas.width = COLS * NATIVE; overlay.canvas.height = ROWS * NATIVE; }
  if (overlay.room !== room || overlay.grid !== showGrid || overlay.foot !== showFootprint) {
    overlay.room = room; overlay.grid = showGrid; overlay.foot = showFootprint;
    const g = overlay.canvas.getContext('2d'), N = NATIVE;
    g.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
    if (showFootprint) {
      g.fillStyle = 'rgba(190,40,30,0.5)';
      for (let i = 0; i < room.struct.length; i++) if (room.struct[i]) g.fillRect((i % COLS) * N, ((i / COLS) | 0) * N, N, N);
    }
    if (showGrid) {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= COLS; x++) { g.moveTo(x * N, 0); g.lineTo(x * N, ROWS * N); }
      for (let y = 0; y <= ROWS; y++) { g.moveTo(0, y * N); g.lineTo(COLS * N, y * N); }
      g.stroke();
    }
  }
  return overlay.canvas;
}
/* Zoomed out (zoom < 0.5) every frame would have to shrink the 48px-per-tile background, and good-quality shrinking is
   by far the most expensive thing in the loop. So once the zoom has settled, the background is shrunk ONCE (high quality)
   into a screen-resolution copy, and each frame just copies pixels 1:1. The camera is snapped to whole screen pixels so
   that copy never needs resampling. While the wheel is still moving, or at zoom >= 0.5, the cheap live path is used. */
const scaled = { canvas: null, room: null, zoom: 0 };
function updateScaledBackground() {
  if (zoom >= 0.5) return false;
  if (scaled.room === cur && scaled.zoom === zoom) return true;
  if (performance.now() - lastZoomChange < 150) return false;          // still zooming: rebuild when it settles
  const w = Math.round(curBg.width * zoom * K), h = Math.round(curBg.height * zoom * K);
  if (!scaled.canvas) scaled.canvas = document.createElement('canvas');
  scaled.canvas.width = w; scaled.canvas.height = h;                     // (re)allocated only here, never per frame
  const g = scaled.canvas.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(curBg, 0, 0, w, h);
  scaled.room = cur; scaled.zoom = zoom; return true;
}
function drawScaled(camSX, camSY, W, H) {                               // camSX/camSY: whole screen pixels
  const c = scaled.canvas;
  const x0 = Math.max(0, camSX), y0 = Math.max(0, camSY), x1 = Math.min(c.width, camSX + W), y1 = Math.min(c.height, camSY + H);
  if (x1 > x0 && y1 > y0) ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0, x0 - camSX, y0 - camSY, x1 - x0, y1 - y0);
}
/* Copies the visible part of a cached canvas to the screen (we are inside ctx.scale(zoom), so units are world px). */
function drawNative(img, camX, camY, VW, VH) {
  const sx0 = Math.max(0, Math.floor(camX / K)), sy0 = Math.max(0, Math.floor(camY / K));
  const sx1 = Math.min(img.width, Math.ceil((camX + VW) / K)), sy1 = Math.min(img.height, Math.ceil((camY + VH) / K));
  if (sx1 <= sx0 || sy1 <= sy0) return;
  ctx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 * K - camX, sy0 * K - camY, (sx1 - sx0) * K, (sy1 - sy0) * K);
}

/* TEMPORARY FPS counter (set FPS_COUNTER = false to hide). 'JS draw' is only the time this script spends per frame;
   FPS and 'slowest frame' are the real numbers to compare. */
const FPS_COUNTER = true;
const fps = { frames: 0, t: 0, worst: 0, work: 0, workMax: 0, shown: 'FPS ...' };

function frame(now) {
  const rawDt = now - (frame.last || now);
  const dt = Math.min(rawDt / 1000, 0.05); frame.last = now;
  const t0 = performance.now();

  let ix = (goRight() ? 1 : 0) - (goLeft() ? 1 : 0), iy = (goDown() ? 1 : 0) - (goUp() ? 1 : 0);
  if (ix && iy) { ix *= Math.SQRT1_2; iy *= Math.SQRT1_2; }
  move(ix * SPEED * dt, iy * SPEED * dt);

  // standing on an exit tile -> warp to the room behind it
  const ptx = Math.floor(p.x / TILE), pty = Math.floor((p.y - HIT.h / 2) / TILE);
  if (inb(ptx, pty) && cur.exitAt.has(idx(ptx, pty))) {
    const d = destination(cur, cur.exitAt.get(idx(ptx, pty))); enter(d.room, d.exit);
  }

  const W = canvas.width, H = canvas.height, VW = W / zoom, VH = H / zoom;
  // camera snapped to whole screen pixels, so the cached pixel art never shimmers while moving
  const camSX = Math.round((p.x - VW / 2) * zoom), camSY = Math.round((p.y - CHAR.h / 2 - VH / 2) * zoom);
  const camX = camSX / zoom, camY = camSY / zoom;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const useScaled = updateScaledBackground();
  if (useScaled) drawScaled(camSX, camSY, W, H);        // ground + structures: a 1:1 copy of the pre-shrunk background
  ctx.save(); ctx.scale(zoom, zoom);
  ctx.imageSmoothingEnabled = zoom < 1;                  // smooth when zoomed out, crisp pixels when zoomed in
  ctx.imageSmoothingQuality = 'low';
  if (!useScaled) drawNative(curBg, camX, camY, VW, VH); // live path: one copy of the cached native background
  if (showGrid || showFootprint) { ctx.imageSmoothingEnabled = true; drawNative(getOverlay(cur), camX, camY, VW, VH); }
  ctx.fillStyle = '#e8923a';
  ctx.fillRect(p.x - CHAR.w / 2 - camX, p.y - CHAR.h - camY, CHAR.w, CHAR.h);
  if (showHit) {
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(p.x - HIT.w / 2 - camX, p.y - HIT.h - camY, HIT.w, HIT.h);
  }
  ctx.restore();

  ctx.fillStyle = '#fff'; ctx.font = '16px monospace';
  ctx.fillText(`room ${cur.id}  type: ${cur.type}  exits: ${cur.exits.map(e => e.dir[0].toUpperCase()).join(' ')}  seed: ${worldSeed}  rooms loaded: ${rooms.size}`, 12, 24);
  ctx.fillText('WASD / arrows / numpad: move   G: grid   H: hitbox   M: minimap   F: footprint   R: new world   cyan tiles = exits', 12, 46);
  ctx.fillText(`zoom: ${zoom.toFixed(2)}   + / - or mouse wheel`, 12, 68);
  const counts = STRUCT_LIST.map(st => `${st.id} x${cur.placements.filter(q => q.id === st.id).length} (p${st.priority} w${st.weight})`).join('  ');
  ctx.fillText(`placed: ${counts}   leftover filled tiles: ${cur.leftover}   (blue = leftover; F = footprint)`, 12, 90);
  const atl = STRUCT_LIST.map(s => s.variants[0].atlas).filter((a, i, arr) => arr.indexOf(a) === i).map(a => `${a}: ${atlases[a] ? atlases[a].status : 'not loaded'}`).join(', ');
  ctx.fillText(`loaded: ${STRUCT_LIST.map(s => s.id).join(', ')} from ${structSource}   atlas ${atl}`, 12, 112);
  structWarnings.slice(0, 5).forEach((w, k) => { ctx.fillStyle = /^ERROR/.test(w) ? '#ff6b6b' : '#ffb347'; ctx.fillText('! ' + w, 12, 134 + k * 20); }); ctx.fillStyle = '#fff';

  if (showMini) {
    const size = 220, s = size / Math.max(COLS, ROWS), mx = W - size - 12, my = 12;
    if (!cur.mini) {
      cur.mini = document.createElement('canvas'); cur.mini.width = COLS; cur.mini.height = ROWS;
      const g = cur.mini.getContext('2d');
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const v = cur.grid[idx(x, y)]; g.fillStyle = v === FULL ? (cur.struct[idx(x, y)] ? '#c8553d' : isBorder(x, y) ? '#667' : '#4f8fe0') : v === EXIT ? '#37d6e8' : '#222'; g.fillRect(x, y, 1, 1);
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cur.mini, mx, my, COLS * s, ROWS * s);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, COLS * s, ROWS * s);
    ctx.fillStyle = '#e8923a';
    ctx.fillRect(mx + (p.x / TILE) * s - 3, my + ((p.y - HIT.h / 2) / TILE) * s - 3, 6, 6);
  }

  if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); fade = Math.max(0, fade - dt * 3); }
  if (!document.hasFocus()) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, H / 2 - 40, W, 80);
    ctx.fillStyle = '#fff'; ctx.font = '24px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Click here to enable keyboard controls', W / 2, H / 2 + 8);
    ctx.textAlign = 'left';
  }
  if (FPS_COUNTER) {
    fps.frames++; fps.t += rawDt; fps.worst = Math.max(fps.worst, rawDt);
    const work = performance.now() - t0; fps.work += work; fps.workMax = Math.max(fps.workMax, work);
    if (fps.t >= 500) {
      fps.shown = `FPS ${(fps.frames * 1000 / fps.t).toFixed(0)}  |  JS draw ${(fps.work / fps.frames).toFixed(1)} ms avg, ${fps.workMax.toFixed(1)} ms max  |  slowest frame ${fps.worst.toFixed(0)} ms`;
      fps.frames = 0; fps.t = 0; fps.worst = 0; fps.work = 0; fps.workMax = 0;
    }
    ctx.font = '16px monospace'; ctx.fillStyle = '#7CFC00'; ctx.fillText(fps.shown, 12, canvas.height - 14);
  }
  requestAnimationFrame(frame);
}
