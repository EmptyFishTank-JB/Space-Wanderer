// The only controls the viewer has: a quiet feed selector (fixed ship
// cameras, the hull camera, the helmet cam), panning within a camera's
// bounds, and fullscreen. Invisible during passive viewing; it surfaces on
// mouse movement or a keypress and fades out after a few seconds.
export function mountSwitcher({ director, cameras, canvas }) {
  const fadeMs = cameras.director.switcherFadeSeconds * 1000;
  const bar = document.createElement('nav');
  bar.className = 'feeds';
  bar.setAttribute('aria-label', 'Camera feeds');
  const buttons = new Map();
  for (const f of cameras.feeds) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${f.id === 'EVA-POV' ? 'EVA-POV' : `${f.id} ${f.label}`}`;
    b.addEventListener('click', () => { director.select(now(), f.id); });
    buttons.set(f.id, b);
    bar.appendChild(b);
  }
  const fs = document.createElement('button');
  fs.type = 'button';
  fs.className = 'fs';
  fs.title = 'Fullscreen (F)';
  fs.textContent = '⛶';
  fs.addEventListener('click', toggleFullscreen);
  bar.appendChild(fs);
  document.body.appendChild(bar);

  let timer = null;
  const show = () => {
    bar.classList.add('shown');
    document.body.classList.remove('passive');
    clearTimeout(timer);
    timer = setTimeout(() => { bar.classList.remove('shown'); document.body.classList.add('passive'); }, fadeMs);
  };
  document.body.classList.add('passive');
  const now = () => performance.now() / 1000;

  window.addEventListener('mousemove', show);
  window.addEventListener('touchstart', show, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    show();
    switch (e.key) {
      case 'ArrowLeft': director.pan(now(), -12); e.preventDefault(); break;
      case 'ArrowRight': director.pan(now(), 12); e.preventDefault(); break;
      case 'ArrowUp': case ']': director.cycle(now(), 1); e.preventDefault(); break;
      case 'ArrowDown': case '[': director.cycle(now(), -1); e.preventDefault(); break;
      case 'f': case 'F': toggleFullscreen(); break;
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
      for (const [id, b] of buttons) b.classList.toggle('on', id === feed);
    },
  };
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
