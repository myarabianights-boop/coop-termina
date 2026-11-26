/* ============ CONFIG ============ */
const COLS = 40, ROWS = 40;          // tiles per room (generation grid only)
const TILE = 96;                     // pixels per tile (atlas tiles are 48px, so this is an exact 2x)
const CHAR = { w: 150, h: 200 };     // sprite size (placeholder)
const HIT  = { w: 75,  h: 100 };     // hitbox, at the character's feet
const SPEED = 450;                   // pixels per second
const NATIVE = 48;                   // the cached room background is drawn at the atlas' native tile size
const DOOR = 4;                      // exit width in tiles
const EDGE_LANE = 0;                 // city: width of the street lane between the border wall and the blocks (0 = blocks can touch the wall)
const EXIT_DEPTH = 3;                // tiles kept clear in front of every exit
const EXIT_MARGIN = 5;               // exits stay this many tiles away from the room corners

const EMPTY = 0, FULL = 1, EXIT = 2; // tile values
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const idx = (x, y) => y * COLS + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;


/* ============ SEEDED RANDOM ============ */
let worldSeed = (Math.random() * 2 ** 32) >>> 0;
function hash(...nums) {
  let h = 2166136261;
  for (const v of nums) { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x85ebca6b); }
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/* ============ PLAYER ============
   x = horizontal center, y = feet, in pixels inside the current room. */
const p = { x: 0, y: 0 };
let cur, curBg, fade = 0;           // curBg = cached background canvas of the current room
function enter(room, exitIdx) {
  cur = room; curBg = getBackground(room);   // built once when the room is entered, not per frame
  const s = spawnPos(room.exits[exitIdx]); p.x = s.x; p.y = s.y; fade = 1;
}
function startWorld() { rooms.clear(); bgSlots.forEach(sl => sl.room = null); overlay.room = null; enter(getRoom(0), 0); fade = 0; }

function solidAt(tx, ty) { return !inb(tx, ty) || cur.grid[idx(tx, ty)] === FULL; }
function blocked(x, y) {
  const l = Math.floor((x - HIT.w / 2) / TILE), r = Math.floor((x + HIT.w / 2 - 0.01) / TILE);
  const t = Math.floor((y - HIT.h) / TILE),     b = Math.floor((y - 0.01) / TILE);
  for (let ty = t; ty <= b; ty++) for (let tx = l; tx <= r; tx++) if (solidAt(tx, ty)) return true;
  return false;
}
function move(dx, dy) {
  if (dx) {
    p.x += dx;
    if (blocked(p.x, p.y)) p.x = dx > 0 ? Math.floor((p.x + HIT.w / 2) / TILE) * TILE - HIT.w / 2 - 0.02
                                        : Math.ceil((p.x - HIT.w / 2) / TILE) * TILE + HIT.w / 2 + 0.02;
  }
  if (dy) {
    p.y += dy;
    if (blocked(p.x, p.y)) p.y = dy > 0 ? Math.floor(p.y / TILE) * TILE - 0.02
                                        : Math.ceil((p.y - HIT.h) / TILE) * TILE + HIT.h + 0.02;
  }
}
