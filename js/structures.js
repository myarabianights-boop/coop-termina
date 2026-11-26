/* ---- Structures: fresh cache -> structures/ folder (via manifest.json) -> stale cache. No built-in copy:
   if nothing loads, the game says so instead of quietly running with missing or outdated definitions. ---- */
const readStructCache = () => { try { return JSON.parse(localStorage.getItem(STRUCT_CACHE_KEY)); } catch (e) { return null; } };
const writeStructCache = o => { try { localStorage.setItem(STRUCT_CACHE_KEY, JSON.stringify(o)); } catch (e) { console.warn('[structures] could not save to localStorage:', e.message || e); } };
async function dropOldCaches() {                                        // remove what older ASSET_VERSIONs left behind
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys())
    if ((k.startsWith(APP_ID + '-atlas-v') && k !== ATLAS_CACHE_NAME) || LEGACY_CACHES.includes(k)) await caches.delete(k); } catch (e) {}
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i);
    if ((k.startsWith(APP_ID + '-structures-v') && k !== STRUCT_CACHE_KEY) || LEGACY_KEYS.includes(k)) localStorage.removeItem(k); } } catch (e) {}
}
async function fetchJson(url) {
  const res = await fetch(url, { cache: USE_CACHE ? 'no-cache' : 'no-store' });   // always revalidate, never trust an old copy
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  try { return await res.json(); } catch (e) { throw new Error('not valid JSON (' + (e.message || e) + ')'); }
}
async function fetchStructureFiles(names) {                            // never throws: a bad file is reported and skipped
  const defs = [], notes = []; let files = 0;
  const results = await Promise.all(names.map(async name => {
    if (!safeName(name)) return { name, error: 'not a plain file name inside ' + STRUCTURES_DIR };
    const url = assetUrl(STRUCTURES_DIR + encodePath(name));
    try { return { name, url, json: await fetchJson(url) }; } catch (e) { return { name, url, error: e.message || String(e) }; }
  }));
  for (const r of results) {
    if (r.error) {
      notes.push(`ERROR: structure file "${r.name}" not loaded: ${r.error}`);
      console.error(`[structures] could not load "${r.name}"${r.url ? ' from ' + r.url : ''}\n  reason: ${r.error}\n` +
        `  check: exact file name and capitalization (GitHub Pages is case-sensitive), and that it is listed in ${STRUCTURES_DIR}${STRUCTURE_MANIFEST}.`);
      continue;
    }
    files++;
    for (const d of (Array.isArray(r.json) ? r.json : [r.json])) defs.push(d && typeof d === 'object' ? { ...d, _file: r.name } : d);
  }
  return { defs, notes, files };
}
async function readStructureDefs() {
  const cached = USE_CACHE ? readStructCache() : null, age = cached ? (Date.now() - cached.time) / 60000 : Infinity;
  if (cached && age < STRUCTURE_CACHE_MINUTES)
    return { defs: cached.defs, notes: [], source: `cache (${Math.round(age)} min old, ${cached.files} file(s) from ${STRUCTURES_DIR})` };
  const notes = []; let names;
  try {                                                                 // a static site cannot list a folder, so the manifest names the files
    const m = await fetchJson(assetUrl(STRUCTURES_DIR + STRUCTURE_MANIFEST));
    if (!Array.isArray(m) || !m.length || !m.every(n => typeof n === 'string')) throw new Error('it must be a JSON array of file names, e.g. ["structures.json"]');
    names = m;
  } catch (e) {
    names = STRUCTURE_FALLBACK_FILES;
    const msg = `${STRUCTURES_DIR}${STRUCTURE_MANIFEST} is not usable (${e.message || e}); reading ${names.join(', ')} only`;
    notes.push('WARNING: ' + msg); console.warn('[structures] ' + msg);
  }
  const got = await fetchStructureFiles(names); notes.push(...got.notes);
  if (got.defs.length) {
    if (USE_CACHE) writeStructCache({ time: Date.now(), defs: got.defs, files: got.files });
    return { defs: got.defs, notes, source: `${STRUCTURES_DIR} (${got.files} file(s))` };
  }
  const old = readStructCache();                                        // the files cannot be read: an old saved copy is better than nothing, but say so
  if (USE_CACHE && old) {
    const m = `the structure files could not be loaded; using a saved copy from ${Math.round((Date.now() - old.time) / 60000)} min ago`;
    console.error('[structures] ' + m); notes.push('ERROR: ' + m);
    return { defs: old.defs, notes, source: 'saved copy (files unreachable)' };
  }
  return { defs: [], notes, source: 'none' };
}
const validStructure = d => d && typeof d.id === 'string' && d.texture && typeof d.texture.atlas === 'string' &&
  Array.isArray(d.texture.tiles) && d.texture.tiles.length > 0 && Array.isArray(d.footprint) && d.footprint.some(r => /[#D]/.test(r));

async function loadStructures() {
  await dropOldCaches();
  const read = await readStructureDefs();
  structSource = read.source;
  const warnings = [...read.notes], seen = new Set(), defs = [];
  for (const d of read.defs) {
    if (!validStructure(d)) { warnings.push(`WARNING: skipped an invalid structure${d && d.id ? ' "' + d.id + '"' : ''}${d && d._file ? ' in ' + d._file : ''}`); continue; }
    if (seen.has(d.id)) { warnings.push(`WARNING: duplicate id "${d.id}"${d._file ? ' in ' + d._file : ''} ignored`); continue; }
    seen.add(d.id); defs.push(d);
  }
  if (!defs.length) throw new Error(`No structure definitions could be loaded from ${assetUrl(STRUCTURES_DIR)}\n` + read.notes.join('\n'));
  await Promise.all([...new Set(defs.map(d => d.texture.atlas))].map(loadAtlas));          // each atlas is downloaded once, in parallel
  for (const [name, a] of Object.entries(atlases)) if (!a.ok) warnings.push(`ERROR: atlas "${name}" not loaded (${a.error}); red squares are shown instead`);
  STRUCT_LIST = defs.map(d => { try { return compileStructure(d); } catch (e) { warnings.push(`ERROR: "${d.id}" skipped: ${e.message}`); return null; } })
    .filter(Boolean).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);   // sorted by id: same result on every client, whatever the file order
  for (const st of STRUCT_LIST) for (const v of st.variants) { const at = atlases[v.atlas]; if (at && at.ok) v.sprite = buildSprite(v, at); }
  structWarnings = [...warnings, ...STRUCT_LIST.flatMap(s => s.warn)].sort((x, y) => /^ERROR/.test(y) - /^ERROR/.test(x));   // errors first
  structWarnings.forEach(w => (/^ERROR/.test(w) ? console.error : console.warn)(w));
}


/* v: variant, (ox, oy): where the footprint's top-left lands in the room */
function fits(g, claimed, v, ox, oy) {
  if (ox + v.box[0] < 0 || oy + v.box[1] < 0 || ox + v.box[2] >= COLS || oy + v.box[3] >= ROWS) return false;   // whole sprite must stay inside the room
  for (let r = 0; r < v.h; r++) for (let c = 0; c < v.w; c++) {
    const ch = v.fp[r][c]; if (ch === '?') continue;
    const x = ox + c, y = oy + r;
    if (ch === '.') { if (DOT_MUST_BE_EMPTY && inb(x, y) && g[idx(x, y)] === FULL) return false; continue; }
    if (!inb(x, y) || isBorder(x, y)) return false;
    const i = idx(x, y); if (g[i] !== FULL || claimed[i]) return false;
    if (ch === 'D' && (!inb(x, y + 1) || g[idx(x, y + 1)] === FULL)) return false;
  }
  return true;
}
/* Runs after finalize(). Structures are placed in PASSES, one per distinct "priority" value, lowest number first
   (priority 1 = first pass; a level nobody uses is simply skipped). Tiles claimed in one pass are closed to the next, so big
   buildings go down first and small ones only fill what is left.
   Within a pass the room is walked in reading order (top-left to bottom-right). At every free FULL tile, each structure of
   that pass whose FIRST occupied cell (top row, leftmost) could land there is checked; those that fit are the candidates.
   ONE is picked at random with probability proportional to its "weight", then one of its fitting variants (normal / mirrored).
   Weights only decide between structures of the same pass that fit at the same spot.
   room.struct[i] = placement number (0 = none). The anchor is stored but does not change the scan. */
function placeStructures(room, rng) {
  const g = room.grid, claimed = new Uint16Array(COLS * ROWS), placements = [];
  const levels = [...new Set(STRUCT_LIST.map(s => s.priority))].sort((a, b) => a - b);
  for (const level of levels) {
    const pool = STRUCT_LIST.filter(s => s.priority === level);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const rPick = rng(), rVar = rng();                // exactly two rng calls per tile and pass keeps it deterministic
      const i0 = idx(x, y);
      if (g[i0] !== FULL || claimed[i0] || isBorder(x, y)) continue;
      const cands = []; let total = 0;
      for (const s of pool) {
        if (s.weight <= 0) continue;
        const fit = s.variants.filter(v => fits(g, claimed, v, x - v.first[0], y - v.first[1]));
        if (fit.length) { cands.push({ s, fit }); total += s.weight; }
      }
      if (!cands.length) continue;
      let r = rPick * total, chosen = cands[cands.length - 1];
      for (const c of cands) { r -= c.s.weight; if (r < 0) { chosen = c; break; } }
      const v = chosen.fit[Math.floor(rVar * chosen.fit.length)], ox = x - v.first[0], oy = y - v.first[1];
      placements.push({ id: chosen.s.id, pass: level, ox, oy, v, anchorAt: [ox + v.anchor[0], oy + v.anchor[1]] });
      for (let r2 = 0; r2 < v.h; r2++) for (let c2 = 0; c2 < v.w; c2++)
        if (v.fp[r2][c2] === '#' || v.fp[r2][c2] === 'D') claimed[idx(ox + c2, oy + r2)] = placements.length;
    }
  }
  room.struct = claimed; room.placements = placements; room.leftover = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === FULL && !claimed[i] && !isBorder(i % COLS, (i / COLS) | 0)) room.leftover++;
}

const generators = { city: genCity /*, labyrinth: ... */ };
