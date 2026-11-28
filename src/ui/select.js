// Selection mode: point at anything in the feed that has data (machines,
// plants, furniture, doors, lights, windows, the traveler, stars and worlds
// on the hull camera) and [brackets] flank it; click or tap to pin a panel
// with its name and details. Off by default; S or the camera menu toggles it.
// While something is pinned the director keeps this camera.
import { picks } from '../render/picks.js';

const KEY = 'terrarium.select';
const STYLE = `
.sel { position: fixed; pointer-events: none; z-index: 6; }
.sel .bk { position: absolute; display: none; }
.sel .bk i { position: absolute; top: 0; bottom: 0; width: 5px; border: 2px solid rgba(150, 240, 200, 0.55); }
.sel .bk i:first-of-type { left: 0; border-right: 0; } .sel .bk i:last-of-type { right: 0; border-left: 0; } /* of-type: the hover box ends with its name tag */
.sel .bk.pin i { border-color: rgba(255, 196, 120, 0.95); }
.sel .tag { position: absolute; left: 0; bottom: calc(100% + 3px); white-space: nowrap; font: 10px ui-monospace, Menlo, Consolas, monospace; color: rgba(190, 245, 220, 0.9); text-shadow: 0 0 3px #000; }
.sel .panel { position: absolute; top: 8px; width: min(260px, 70%); display: none; background: rgba(2, 10, 8, 0.55); border: 1px solid rgba(255, 196, 120, 0.45);
  padding: 8px 10px; font: 10px/1.5 ui-monospace, Menlo, Consolas, monospace; color: rgba(190, 240, 215, 0.9); letter-spacing: 0.03em; }
.sel .panel .n { font-weight: 600; color: rgba(255, 226, 190, 0.98); font-size: 11px; }
.sel .panel .s { color: rgba(150, 210, 185, 0.6); margin-bottom: 4px; }
.sel .panel .r { display: grid; grid-template-columns: 12ch 1fr; gap: 6px; }
.sel .panel .r b { font-weight: 400; color: rgba(150, 210, 185, 0.6); }
body.selecting #feed { cursor: crosshair; }
`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function readPref() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function writePref(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* fine */ } }

export function mountSelection({ canvas, director }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'sel';
  el.innerHTML = '<div class="bk hover"><i></i><i></i><span class="tag"></span></div><div class="bk pin"><i></i><i></i></div><div class="panel" role="status"></div>';
  document.body.appendChild(el);
  const hover = el.querySelector('.hover'), pin = el.querySelector('.pin'), panel = el.querySelector('.panel'), tag = el.querySelector('.tag');
  let on = readPref();
  let pinned = null;
  let mouse = null;
  let nextText = 0, nextHold = 0;
  const listeners = new Set();
  document.body.classList.toggle('selecting', on);

  const scale = () => canvas.getBoundingClientRect().width / 320;
  const toFb = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 320, ((e.clientY - r.top) / r.height) * 180]; };
  function placeBox(node, p) {
    const k = scale();
    Object.assign(node.style, { display: 'block', left: `${Math.round(p.x * k) - 4}px`, top: `${Math.round(p.y * k) - 3}px`, width: `${Math.round(p.w * k) + 8}px`, height: `${Math.round(p.h * k) + 6}px` });
  }
  function showPanel(p) {
    const info = p.info();
    panel.innerHTML = `<div class="n">${esc(info.name)}</div><div class="s">${esc(info.sub || '')}</div>`
      + (info.lines || []).map(([k, v]) => `<div class="r"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    const right = p.x + p.w / 2 < 160; // panel on the side away from the object
    Object.assign(panel.style, { display: 'block', left: right ? 'auto' : '8px', right: right ? '8px' : 'auto' });
  }
  function clear() { pinned = null; pin.style.display = 'none'; panel.style.display = 'none'; }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!on || !down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 5) return; // that was a pan
    const [x, y] = toFb(e);
    const p = picks.at(x, y);
    if (!p) { clear(); return; }
    pinned = p.id;
    nextText = 0;
  });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouse = toFb(e); });
  canvas.addEventListener('pointerleave', () => { mouse = null; });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.body.classList.contains('walking')) return; // S walks backward while walking
    if (e.key === 's' || e.key === 'S') api.toggle();
    if (e.key === 'Escape') clear();
  });

  const api = {
    get on() { return on; },
    toggle(v = !on) { on = v; writePref(on); document.body.classList.toggle('selecting', on); if (!on) { clear(); hover.style.display = 'none'; } for (const fn of listeners) fn(on); },
    onChange(fn) { listeners.add(fn); },
    update(fr) {
      const r = canvas.getBoundingClientRect();
      Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      if (!on) return;
      const h = mouse && picks.at(mouse[0], mouse[1]);
      if (h && h.id !== pinned) { placeBox(hover, h); tag.textContent = h.info().name; } else hover.style.display = 'none';
      if (!pinned) return;
      const p = picks.byId(pinned);
      if (!p) { clear(); return; } // the camera changed or it left the frame
      placeBox(pin, p);
      if (fr.t >= nextText) { showPanel(p); nextText = fr.t + 0.5; }
      if (fr.t >= nextHold) { director.pan(fr.t, 0); nextHold = fr.t + 1; } // keep this camera while something is pinned
    },
  };
  return api;
}
