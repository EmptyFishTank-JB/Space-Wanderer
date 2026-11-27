// Walk the ship: a first-person mode in the observation window. W (or the
// camera menu) steps in; Esc steps back out to the cameras. WASD or the arrow
// keys walk, the mouse looks (click to capture it), Shift runs, C crouches,
// E opens and shuts doors and shutters and climbs up ladders, the lift and
// through duct grilles, Q climbs down, H sets every shutter at once, G goes
// to wherever the traveler is, P shows the deck plan. On a touch screen: a
// stick on the left, drag on the right to look, buttons for the rest.
// Only a viewer: the walk never changes the simulation.
import { buildWorld, doorNear, roomPoint } from '../walk/world.js';
import { Walker } from '../walk/walker.js';
import { WalkView } from '../walk/render.js';
import { setShut, setAllShut, isShut, manualShut } from '../render/shutters.js';

const STYLE = `
body.walking #feed { cursor: crosshair; }
body.walking .boot-status.hint { display: none; }
.walk-touch { position: fixed; inset: 0; pointer-events: none; z-index: 9; display: none; font: 11px ui-monospace, Menlo, Consolas, monospace; }
body.walking.touch .walk-touch { display: block; }
.walk-touch .stick { position: absolute; left: 18px; bottom: 18px; width: 120px; height: 120px; border-radius: 50%; border: 1px solid rgba(150, 240, 190, 0.35); background: rgba(0, 0, 0, 0.25); pointer-events: auto; touch-action: none; }
.walk-touch .knob { position: absolute; left: 40px; top: 40px; width: 40px; height: 40px; border-radius: 50%; background: rgba(150, 240, 190, 0.35); }
.walk-touch .look { position: absolute; right: 0; top: 0; width: 55%; height: 100%; pointer-events: auto; touch-action: none; }
.walk-touch .btns { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); display: grid; grid-template-columns: repeat(3, 46px); gap: 8px; pointer-events: auto; }
.walk-touch button { all: unset; text-align: center; padding: 12px 0; color: rgba(220, 240, 230, 0.85); border: 1px solid rgba(150, 240, 190, 0.35); background: rgba(0, 0, 0, 0.45); border-radius: 6px; }
`;

export function mountWalk({ canvas, data, ship3d, onChange = () => {} }) {
  const world = buildWorld(ship3d, data);
  const walker = new Walker(world);
  const view = new WalkView(world, data);
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  let on = false, placed = false, lastSim = 'corridor_aft', state = null, toast = null;
  const keys = new Set();
  let look = [0, 0];
  const touch = { move: [0, 0], look: null };

  const say = (text, secs = 2.5) => { toast = { text, until: performance.now() / 1000 + secs }; };
  const nearTraveler = (s) => {
    const tr = s.traveler, r = world.rooms[tr.pos.room];
    if (!r) { walker.place('bridge', null, null, 0); return false; }
    // a couple of meters along the room from them, turned to face them
    const at = roomPoint(r, tr.pos.x, 0.95);
    const off = tr.pos.x + 2 < r.len - 0.5 ? 2 : -2;
    const me = roomPoint(r, tr.pos.x + off, 1.6);
    walker.place(r.id, me[0], me[1]);
    walker.yaw = Math.atan2(at[1] - walker.y, at[0] - walker.x);
    walker.pitch = -0.08;
    return true;
  };

  function enter(s) {
    if (on) return;
    on = true;
    document.body.classList.add('walking');
    if (!placed && s) { nearTraveler(s); placed = true; }
    view.helpUntil = performance.now() / 1000 + 9;
    onChange(true);
  }
  function exit() {
    if (!on) return;
    on = false;
    keys.clear();
    document.body.classList.remove('walking');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    onChange(false);
  }

  // ── the things in reach: what E and Q would do right now ──
  function windowAhead() {
    const r = walker.mode === 'room' && walker.room;
    if (!r) return null;
    const f = [Math.cos(walker.pitch) * Math.cos(walker.yaw), Math.cos(walker.pitch) * Math.sin(walker.yaw), Math.sin(walker.pitch)];
    const eye = walker.eye;
    let best = null, bd = 0.82;
    const consider = (id, name, c) => {
      const d = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], L = Math.hypot(...d);
      if (L > 7) return;
      const cos = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / L;
      if (cos > bd) { bd = cos; best = { id, name }; }
    };
    for (const b of r.bays) { const pts = b.glass.flat(); consider(b.win, b.name, [0, 1, 2].map((i) => pts.reduce((a, p) => a + p[i], 0) / pts.length)); }
    for (const w of r.walls) for (const o of r.openings[w.side]) if (o.win) { const s = (o.s0 + o.s1) / 2; consider(o.win.id, o.win.name, [w.a[0] + w.dir[0] * s, w.a[1] + w.dir[1] * s, r.z[0] + (o.z0 + o.z1) / 2]); }
    return best;
  }
  const roomName = (id) => world.rooms[id].name.toUpperCase();
  /** What E and Q would do right now, best first: a door you're looking at, the way up or down you're standing at, the shutters ahead, a door beside you. */
  function actions(s) {
    if (walker.busy) return [];
    const out = [];
    const lk = view.look;
    const doorLabel = (d) => `${d.wantOpen ? 'SHUT' : 'OPEN'} DOOR TO ${roomName(walker.room && d.a === walker.room.id ? d.b : d.a)}`;
    const door = (d) => ({ key: 'E', label: doorLabel(d), run: () => { d.wantOpen = !d.wantOpen; } });
    if (walker.mode === 'room' && lk && lk.kind === 'door' && lk.dist < 2.6) out.push(door(lk.door));
    for (const x of walker.exits()) {
      const key = x.dir === 'up' ? 'E' : 'Q';
      let label;
      if (x.sealed) label = 'LIFEBOAT HATCH (SEALED)';
      else if (x.shaft) label = `${x.shaft.kind === 'lift' ? 'LIFT' : 'CLIMB'} ${x.dir.toUpperCase()} TO ${roomName(x.to)}`;
      else if (x.grille && walker.mode === 'room') label = `${x.dir === 'up' ? 'UP' : 'DOWN'} INTO THE DUCT`;
      else if (x.grille) label = `OUT INTO ${roomName(x.to)}`;
      else if (x.vent) label = `RUNGS ${x.dir.toUpperCase()} TO ${world.ducts.find((q) => q.id === x.duct).name.toUpperCase()}`;
      out.push({ key, label, run: () => { if (walker.go(x.dir) === 'sealed') say('The lifeboat hatch is sealed: it opens only to abandon ship.'); } });
    }
    const w = windowAhead();
    if (w) out.push({ key: 'E', label: `${isShut(s, w.id) ? 'OPEN' : 'CLOSE'} SHUTTERS${manualShut(w.id) !== undefined ? ' (BY HAND)' : ' (AUTO)'}`, run: () => { const shut = !isShut(s, w.id); setShut(w.id, shut); say(`${w.name}: shutters ${shut ? 'closing' : 'opening'}`); } });
    const near = walker.mode === 'room' && doorNear(world, walker.deck, walker.x, walker.y, walker.yaw);
    if (near && !out.some((o) => o.label === doorLabel(near))) out.push(door(near));
    return out;
  }
  function prompts(s) {
    if (walker.busy) return [walker.move.kind === 'lift' ? 'RIDING THE LIFT' : walker.move.kind === 'grille' ? 'THROUGH THE GRILLE' : 'CLIMBING'];
    const acts = actions(s);
    const e = acts.find((a) => a.key === 'E'), q = acts.find((a) => a.key === 'Q');
    return [e && `E ${e.label}`, q && `Q ${q.label}`, walker.crouch ? 'C STAND UP' : walker.mode === 'duct' ? 'CRAWLING' : null].filter(Boolean).map((x) => x.slice(0, 46));
  }
  function act(s, key) {
    const a = actions(s).find((x) => x.key === key);
    if (a) a.run();
  }
  function allShutters(s) {
    // auto → all closed by hand → all open by hand → back to auto
    const ids = view.windowIds;
    const st = ids.every((id) => manualShut(id) === true) ? 'closed' : ids.every((id) => manualShut(id) === false) ? 'open' : 'auto';
    if (st === 'auto') { setAllShut(ids, true); say('All shutters: closed by hand'); }
    else if (st === 'closed') { setAllShut(ids, false); say('All shutters: open by hand'); }
    else { setAllShut(ids, null); say('All shutters: automatic (the ship closes them in supercruise, hyperspace and scooping)', 4); }
    void s;
  }

  // ── input ──
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!on) { if ((e.key === 'w' || e.key === 'W') && state) enter(state); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(k)) e.preventDefault();
    if (e.repeat && !['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    keys.add(k);
    if (k === 'Shift') keys.add('shift');
    if (k === 'Escape') exit();
    if (k === 'e') act(state, 'E');
    if (k === 'q') act(state, 'Q');
    if (k === 'c') walker.toggleCrouch();
    if (k === 'p') view.mapOn = !view.mapOn;
    if (k === 'h') allShutters(state);
    if (k === 'g') { if (nearTraveler(state)) say('Beside the traveler'); else say('The traveler is not aboard: the bridge'); }
    if (k === '?' || k === '/') view.helpUntil = performance.now() / 1000 + 9;
  });
  window.addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); if (k === 'Shift') keys.delete('shift'); });
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('click', () => { if (on && document.pointerLockElement !== canvas && !matchMedia('(pointer: coarse)').matches && canvas.requestPointerLock) canvas.requestPointerLock(); });
  // without pointer lock (or before it's granted): drag to look
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (on && e.pointerType === 'mouse') drag = [e.clientX, e.clientY]; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('mousemove', (e) => {
    if (!on) return;
    const sens = 0.0026;
    if (document.pointerLockElement === canvas) { look[0] += e.movementX * sens; look[1] -= e.movementY * sens; }
    else if (drag) { look[0] += (e.clientX - drag[0]) * sens * 1.4; look[1] -= (e.clientY - drag[1]) * sens * 1.4; drag = [e.clientX, e.clientY]; }
  });

  // touch: a stick, a look pad, buttons
  const pad = document.createElement('div');
  pad.className = 'walk-touch';
  pad.innerHTML = '<div class="look"></div><div class="stick"><div class="knob"></div></div><div class="btns"><button data-k="e">E</button><button data-k="q">Q</button><button data-k="c">C</button><button data-k="p">MAP</button><button data-k="g">FIND</button><button data-k="x">EXIT</button></div>';
  document.body.appendChild(pad);
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  const stick = pad.querySelector('.stick'), knob = pad.querySelector('.knob'), lookPad = pad.querySelector('.look');
  const stickAt = (e) => { const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left - 60) / 50, y = (e.clientY - r.top - 60) / 50; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } touch.move = [-y, x]; knob.style.left = `${40 + x * 40}px`; knob.style.top = `${40 + y * 40}px`; };
  stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); stickAt(e); });
  stick.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') stickAt(e); });
  stick.addEventListener('pointerup', () => { touch.move = [0, 0]; knob.style.left = '40px'; knob.style.top = '40px'; });
  lookPad.addEventListener('pointerdown', (e) => { lookPad.setPointerCapture(e.pointerId); touch.look = [e.clientX, e.clientY]; });
  lookPad.addEventListener('pointermove', (e) => { if (!touch.look) return; look[0] += (e.clientX - touch.look[0]) * 0.006; look[1] -= (e.clientY - touch.look[1]) * 0.006; touch.look = [e.clientX, e.clientY]; });
  lookPad.addEventListener('pointerup', () => { touch.look = null; });
  pad.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'x') exit(); else if (k === 'e') act(state, 'E'); else if (k === 'q') act(state, 'Q'); else if (k === 'c') walker.toggleCrouch(); else if (k === 'p') view.mapOn = !view.mapOn; else if (k === 'g') nearTraveler(state);
  }));

  return {
    get on() { return on; },
    world, walker, view,
    enter: (s) => enter(s || state), exit, toggle: (s) => (on ? exit() : enter(s || state)),
    /** A different ship to walk (the tester's staged scenes): start again beside the traveler. */
    reset(s) { state = s; placed = false; if (on && s) { nearTraveler(s); placed = true; } },
    /** Keep a handle on the live state (for W to step in before the first walking frame). */
    see(s) { state = s; },
    /** One frame: move, then draw into the 320×180 framebuffer. */
    frame(ctx, m) {
      state = m.state;
      const dt = Math.min(0.1, m.dt || 0);
      const k = (n) => keys.has(n);
      const fwd = (k('w') || k('ArrowUp') ? 1 : 0) - (k('s') || k('ArrowDown') ? 1 : 0) + touch.move[0];
      const side = (k('d') ? 1 : 0) - (k('a') ? 1 : 0) + touch.move[1];
      const turn = ((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0)) * 1.9;
      walker.step(dt, { fwd, side, run: k('shift'), turn, look });
      look = [0, 0];
      if (walker.room && walker.room.sim) lastSim = walker.room.id;
      view.prompts = prompts(m.state);
      view.render(ctx, { ...m, dt }, walker);
      if (toast && performance.now() / 1000 < toast.until) view.toastDraw(ctx, toast.text);
    },
    /** What the sound and the captions should treat as "the camera" while walking. */
    feedDef() { return { id: 'WALK', label: 'WALK', room: lastSim, walk: true }; },
  };
}
