// The ship's own telemetry, overlaid on the feed: off by default, toggled
// from the camera menu or with T, remembered per browser. Three quiet
// corner panels: camera and location, the traveler, the ship.
import { telemetryFor } from './telemetry-model.js';
import { ACTIONS } from '../sim/ai/actions.js';

const KEY = 'terrarium.telemetry';

const STYLE = `
.tm { position: fixed; pointer-events: none; z-index: 5; font: 10px/1.45 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.04em;
  color: rgba(170, 236, 210, 0.86); text-shadow: 0 0 3px #000, 0 0 1px #000; opacity: 0; transition: opacity 0.5s ease; }
.tm.on { opacity: 1; }
.tm .p { position: absolute; background: rgba(2, 10, 8, 0.42); border: 1px solid rgba(120, 220, 180, 0.18); padding: 6px 8px; max-width: 46%; }
.tm .tl { left: 8px; top: 8px; } .tm .tr { right: 8px; top: 8px; min-width: 190px; } .tm .br { right: 8px; bottom: 8px; }
.tm .h { color: rgba(120, 220, 180, 0.6); font-size: 9px; letter-spacing: 0.14em; }
.tm .b { font-weight: 600; color: rgba(214, 248, 232, 0.95); }
.tm .row { display: grid; grid-template-columns: 7ch 1fr 4ch; gap: 6px; align-items: center; }
.tm .bar { height: 4px; background: rgba(120, 220, 180, 0.15); }
.tm .bar i { display: block; height: 100%; background: rgba(150, 240, 200, 0.75); }
.tm .bar i.hi { background: rgba(250, 190, 110, 0.85); } .tm .bar i.crit { background: rgba(255, 110, 90, 0.9); }
.tm .warn { color: rgba(255, 190, 120, 0.95); }
/* small feeds (phones): the panels stack under the picture instead of covering it */
.tm.stack { display: grid; gap: 6px; padding: 0 12px; box-sizing: border-box; align-content: start; }
.tm.stack .p { position: static; max-width: none; min-width: 0; }
body.tm-top { place-items: start center; padding-top: 10px; box-sizing: border-box; }
`;

function readPref() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function writePref(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window: still works for this session */ } }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function mountTelemetry({ canvas }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'tm';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="p tl"></div><div class="p tr"></div><div class="p br"></div>';
  document.body.appendChild(el);
  const [tl, tr, br] = el.querySelectorAll('.p');
  let on = readPref();
  let next = 0;
  const listeners = new Set();
  const place = () => {
    let r = canvas.getBoundingClientRect();
    const stack = r.width < 560;
    const top = stack && on;
    if (document.body.classList.contains('tm-top') !== top) { document.body.classList.toggle('tm-top', top); r = canvas.getBoundingClientRect(); }
    el.classList.toggle('stack', stack);
    if (stack) Object.assign(el.style, { left: '0px', top: `${r.bottom + 8}px`, width: `${innerWidth}px`, height: `${Math.max(0, innerHeight - r.bottom - 50)}px`, overflow: 'hidden' });
    else Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, overflow: 'visible' });
  };
  window.addEventListener('resize', place);
  place();
  el.classList.toggle('on', on);

  function render(fr) {
    const a = fr.state.traveler.activity;
    const ex = a && a.phase === 'perform' && ACTIONS[a.id] ? ACTIONS[a.id].exertion : fr.state.traveler.move ? 1.2 : 0.6;
    const m = telemetryFor(fr.state, fr.data, fr.feedDef, ex);
    tl.innerHTML = `<div class="h">CAMERA</div><div class="b">${esc(m.camera.feed)}</div><div>${esc(m.camera.room)}</div>`
      + `<div class="h" style="margin-top:4px">LOCATION</div><div class="b">${esc(m.location.system)}</div><div>${esc(m.location.star)}</div>`
      + `<div>${esc(m.location.status)}</div><div>star ${esc(m.location.starDistance)}</div><div>${esc(m.location.time)}</div>`;
    const bar = (v) => `<span class="bar"><i class="${v >= 85 ? 'crit' : v >= 65 ? 'hi' : ''}" style="width:${v}%"></i></span>`;
    const t = m.traveler;
    tr.innerHTML = `<div class="h">TRAVELER · ${esc(t.where.toUpperCase())}${t.inView ? ' · IN VIEW' : ''}</div><div class="b">${esc(t.doing)}</div>`
      + `<div class="needs">${t.needs.map((x) => `<div class="row"><span>${x.k}</span>${bar(x.v)}<span>${x.v}%</span></div>`).join('')}</div>`
      + `<div>mood · wonder ${t.mood.wonder}% · weariness ${t.mood.weariness}%</div>`
      + `<div>HR ${t.vitals.hr} bpm (est.) · ${t.vitals.temp.toFixed(1)} °C · condition ${t.vitals.condition}%</div>`;
    const s = m.ship;
    br.innerHTML = `<div class="h">SHIP</div><div>power ${esc(s.power)} · battery ${s.battery}% · reactor ${s.reactorKW} kW</div>`
      + `<div>fuel ${esc(s.fuel)} · heat <span class="${s.heat >= 70 ? 'warn' : ''}">${s.heat}%</span></div>`
      + `<div>O₂ ${s.o2}% · CO₂ <span class="${s.co2 >= 3000 ? 'warn' : ''}">${s.co2} ppm</span> · water ${s.water} L</div>`
      + `<div class="${s.faults ? 'warn' : ''}">${s.faults ? `${s.faults} fault${s.faults > 1 ? 's' : ''} open` : 'all systems nominal'}</div>`
      + `<div class="${s.combat ? 'warn' : ''}">shield ${esc(s.shield)} · magazine ${esc(s.ammo)}${s.brig ? ` · brig: ${esc(s.brig)}` : ''}${s.combat ? ` · UNDER ATTACK: ${esc(s.combat)}` : ''}</div>`
      + `<div>${s.credits.toLocaleString('en-US')} cr${s.missions.length ? ` · ${s.missions.length} mission${s.missions.length > 1 ? 's' : ''}: ${esc(s.missions[0])}${s.missions.length > 1 ? '…' : ''}` : ''}</div>`;
  }

  return {
    get on() { return on; },
    toggle(v = !on) { on = v; writePref(on); el.classList.toggle('on', on); next = 0; place(); for (const fn of listeners) fn(on); },
    onChange(fn) { listeners.add(fn); },
    update(fr) {
      if (!on || fr.t < next) return;
      next = fr.t + 0.5; // twice a second is plenty for telemetry
      place();
      render(fr);
    },
  };
}
