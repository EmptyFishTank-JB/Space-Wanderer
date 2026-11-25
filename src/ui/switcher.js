// The only controls the viewer has: a quiet camera menu (one button showing
// the current feed, opening into sections), telemetry on/off, panning within
// a camera's bounds, and fullscreen. Invisible during passive viewing; it
// surfaces on mouse movement, a touch or a keypress and fades out after a few
// seconds (never while the menu is open).

const SECTION_ORDER = ['Command', 'Living', 'Life support', 'Engineering', 'Service', 'Passages', 'Exterior'];
const SECTION_OF = {
  bridge: 'Command', lounge: 'Living', quarters: 'Living', galley: 'Living', hydro: 'Life support', lifesupport: 'Life support',
  engineering: 'Engineering', workshop: 'Engineering', storage: 'Service', airlock: 'Service', corridor_fore: 'Passages', corridor_aft: 'Passages',
};
export const sectionOf = (f) => (f.room ? SECTION_OF[f.room] || 'Service' : 'Exterior');
const feedName = (f) => (f.id === 'EVA-POV' ? 'EVA-POV HELMET' : `${f.id} ${f.label}`);

const STYLE = `
.feeds { position: fixed; left: 12px; bottom: 10px; display: flex; align-items: flex-end; gap: 8px; font: 10px/1.2 ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: 0.06em; opacity: 0; transition: opacity 0.9s ease; pointer-events: none; z-index: 10; }
.feeds.shown { opacity: 1; pointer-events: auto; transition-duration: 0.25s; }
.feeds button { all: unset; cursor: pointer; color: rgba(190, 210, 200, 0.6); padding: 4px 6px; }
.feeds button:hover { color: rgba(220, 235, 228, 0.9); }
.feeds button:focus-visible { outline: 1px solid rgba(150, 240, 190, 0.6); }
.feeds .trigger { color: rgba(150, 240, 190, 0.85); border: 1px solid rgba(150, 240, 190, 0.25); background: rgba(0, 0, 0, 0.45); }
.feeds .menu { position: absolute; left: 0; bottom: calc(100% + 6px); min-width: 230px; max-height: min(70vh, 520px); overflow-y: auto;
  background: rgba(4, 10, 9, 0.92); border: 1px solid rgba(150, 240, 190, 0.22); padding: 6px 0; display: none; }
.feeds .menu.open { display: block; }
.feeds .sec { padding: 6px 12px 2px; color: rgba(120, 200, 165, 0.55); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; }
.feeds .menu button { display: block; width: 100%; box-sizing: border-box; padding: 4px 12px 4px 18px; }
.feeds .menu button.on { color: rgba(150, 240, 190, 0.95); }
.feeds .menu button.on::before { content: '▸'; position: absolute; margin-left: -10px; }
.feeds .menu hr { border: 0; border-top: 1px solid rgba(150, 240, 190, 0.14); margin: 6px 0; }
.feeds .toggle.on { color: rgba(150, 240, 190, 0.95); }
`;

export function mountSwitcher({ director, cameras, canvas, telemetry = null, selection = null }) {
  const fadeMs = cameras.director.switcherFadeSeconds * 1000;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const bar = document.createElement('nav');
  bar.className = 'feeds';
  bar.setAttribute('aria-label', 'Camera feeds');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  const buttons = new Map();
  const bySection = new Map(SECTION_ORDER.map((s) => [s, []]));
  for (const f of cameras.feeds) {
    const s = sectionOf(f);
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(f);
  }
  for (const [name, feeds] of bySection) {
    if (!feeds.length) continue;
    const h = document.createElement('div');
    h.className = 'sec';
    h.textContent = name;
    menu.appendChild(h);
    for (const f of feeds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.textContent = feedName(f);
      b.addEventListener('click', () => { director.select(now(), f.id); close(); });
      buttons.set(f.id, b);
      menu.appendChild(b);
    }
  }
  menu.appendChild(document.createElement('hr'));
  let tmBtn = null;
  if (telemetry) {
    tmBtn = document.createElement('button');
    tmBtn.type = 'button';
    tmBtn.className = 'toggle';
    tmBtn.setAttribute('role', 'menuitemcheckbox');
    const sync = (on) => { tmBtn.textContent = `TELEMETRY ${on ? 'ON' : 'OFF'}  (T)`; tmBtn.classList.toggle('on', on); tmBtn.setAttribute('aria-checked', String(on)); };
    sync(telemetry.on);
    telemetry.onChange(sync);
    tmBtn.addEventListener('click', () => telemetry.toggle());
    menu.appendChild(tmBtn);
  }
  if (selection) {
    const sb = document.createElement('button');
    sb.type = 'button';
    sb.className = 'toggle';
    sb.setAttribute('role', 'menuitemcheckbox');
    const sync = (v) => { sb.textContent = `SELECT ${v ? 'ON' : 'OFF'}  (S)`; sb.classList.toggle('on', v); sb.setAttribute('aria-checked', String(v)); };
    sync(selection.on);
    selection.onChange(sync);
    sb.addEventListener('click', () => selection.toggle());
    menu.appendChild(sb);
  }
  const fs = document.createElement('button');
  fs.type = 'button';
  fs.textContent = 'FULLSCREEN  (F)';
  fs.addEventListener('click', () => { toggleFullscreen(); close(); });
  menu.appendChild(fs);
  bar.append(menu, trigger);
  document.body.appendChild(bar);

  let open = false;
  const setOpen = (v) => { open = v; menu.classList.toggle('open', v); trigger.setAttribute('aria-expanded', String(v)); if (v) show(); };
  const close = () => setOpen(false);
  trigger.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  document.addEventListener('click', (e) => { if (open && !bar.contains(e.target)) close(); });

  let timer = null;
  function show() {
    bar.classList.add('shown');
    document.body.classList.remove('passive');
    clearTimeout(timer);
    timer = setTimeout(function fade() {
      if (open) { timer = setTimeout(fade, fadeMs); return; }
      bar.classList.remove('shown');
      document.body.classList.add('passive');
    }, fadeMs);
  }
  document.body.classList.add('passive');
  const now = () => performance.now() / 1000;

  window.addEventListener('mousemove', show);
  window.addEventListener('touchstart', show, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    show();
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowLeft': director.pan(now(), -12); e.preventDefault(); break;
      case 'ArrowRight': director.pan(now(), 12); e.preventDefault(); break;
      case 'ArrowUp': case ']': director.cycle(now(), 1); e.preventDefault(); break;
      case 'ArrowDown': case '[': director.cycle(now(), -1); e.preventDefault(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 't': case 'T': if (telemetry) telemetry.toggle(); break;
      case 'c': case 'C': setOpen(!open); break;
      default: break;
    }
  });
  // gentle drag-to-pan on the feed itself
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    const dx = e.clientX - drag;
    drag = e.clientX;
    const scale = canvas.clientWidth / 320;
    director.pan(now(), -dx / scale);
  });
  canvas.addEventListener('pointerup', () => { drag = null; });

  return {
    setActive(feed) {
      for (const [id, b] of buttons) { b.classList.toggle('on', id === feed); b.setAttribute('aria-checked', String(id === feed)); }
      const f = cameras.feeds.find((x) => x.id === feed);
      trigger.textContent = `${f ? feedName(f) : feed}  ▾`;
    },
  };
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
