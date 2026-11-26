/* ============ INPUT ============ */
const keys = new Set(), codes = new Set();
let showGrid = false, showHit = true, showMini = true, showFootprint = false, zoom = 0.35, lastZoomChange = 0;
const setZoom = z => { zoom = Math.min(1.5, Math.max(0.1, z)); lastZoomChange = performance.now(); };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); keys.add(k); codes.add(e.code);
  if (!e.repeat) {
    if (k === 'g') showGrid = !showGrid;
    if (k === 'h') showHit = !showHit;
    if (k === 'm') showMini = !showMini;
    if (k === 'f') showFootprint = !showFootprint;
    if (k === 'r') { worldSeed = (Math.random() * 2 ** 32) >>> 0; startWorld(); }
  }
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') setZoom(zoom * 1.1);
  if (e.key === '-' || e.code === 'NumpadSubtract') setZoom(zoom / 1.1);
  if (k.startsWith('arrow') || e.code.startsWith('Numpad') || k === ' ') e.preventDefault();
});
addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); codes.delete(e.code); });
addEventListener('blur', () => { keys.clear(); codes.clear(); });
addEventListener('pointerdown', () => window.focus());
addEventListener('wheel', e => { setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); e.preventDefault(); }, { passive: false });
const any = (names, cs) => names.some(n => keys.has(n)) || cs.some(c => codes.has(c));
const goLeft  = () => any(['a', 'arrowleft'],  ['Numpad4', 'Numpad7', 'Numpad1']);
const goRight = () => any(['d', 'arrowright'], ['Numpad6', 'Numpad9', 'Numpad3']);
const goUp    = () => any(['w', 'arrowup'],    ['Numpad8', 'Numpad7', 'Numpad9']);
const goDown  = () => any(['s', 'arrowdown'],  ['Numpad2', 'Numpad1', 'Numpad3', 'Numpad5']);
