// Sound controls: the browser needs one click before audio may play, so a
// faint "click for sound" hint appears now and then until it has. Mute
// toggles with M or the SND entry in the feed selector; the choice is
// remembered for this viewer only.
const KEY = 'deep-space-terrarium.muted';

function load() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function save(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode: fine */ } }

export function mountSound({ audio }) {
  audio.setMuted(load());
  const hint = document.createElement('div');
  hint.className = 'sound-hint';
  hint.textContent = 'click for sound';
  document.body.appendChild(hint);

  // the SND toggle sits in the feed selector, before fullscreen
  const bar = document.querySelector('.feeds');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'snd';
  btn.title = 'Mute (M)';
  const label = () => { btn.textContent = audio.muted ? 'SND OFF' : 'SND ON'; btn.classList.toggle('on', !audio.muted && audio.enabled); };
  label();
  if (bar) bar.insertBefore(btn, bar.querySelector('.fs'));

  const showHint = (ms) => {
    if (audio.enabled) return;
    hint.classList.add('shown');
    clearTimeout(showHint.t);
    showHint.t = setTimeout(() => hint.classList.remove('shown'), ms);
  };
  setTimeout(() => showHint(6000), 1800);
  window.addEventListener('mousemove', () => showHint(3000));

  const enable = async () => {
    if (audio.enabled) return;
    try { await audio.enable(); } catch (e) { console.warn('terrarium: audio unavailable', e); }
    hint.classList.remove('shown');
    label();
  };
  window.addEventListener('pointerdown', enable);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    enable();
    if (e.key === 'm' || e.key === 'M') toggle();
  });
  function toggle() {
    audio.setMuted(!audio.muted);
    save(audio.muted);
    label();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); enable().then(() => { if (e.isTrusted) toggle(); }); });
}
