// Browser entry point (Phase 1): load data, restore + catch up the traveler,
// run the sim live at 1:1, persist continuously. There is nothing to *see*
// yet — the pixel-art renderer arrives in Phase 3. Append ?debug to the URL
// for a developer inspector (not part of the experience).
import { prepareData, DATA_FILES, bootSimulation, LiveRunner } from './sim/index.js';
import { SnapshotStore, MemoryStorage } from './persist/snapshot.js';
import { IndexedDBJournal, MemoryJournal } from './persist/journal.js';
import { buildBackup, parseBackup } from './persist/backup.js';

async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (k) => {
    const res = await fetch(new URL(`../data/${k}.json`, import.meta.url));
    if (!res.ok) throw new Error(`failed to load data/${k}.json`);
    raw[k] = await res.json();
  }));
  return prepareData(raw);
}

function pickStorage() {
  try {
    const k = '__terrarium_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    console.warn('terrarium: localStorage unavailable; running without persistence');
    return new MemoryStorage();
  }
}

async function openJournal() {
  try {
    return await IndexedDBJournal.open();
  } catch (err) {
    console.warn('terrarium: IndexedDB unavailable; journal kept in memory', err);
    return new MemoryJournal();
  }
}

async function main() {
  const data = await loadData();
  const snapshots = new SnapshotStore(pickStorage(), data);
  const journal = await openJournal();
  const params = new URLSearchParams(location.search);

  const { state, plan } = await bootSimulation({
    data, snapshots, journal,
    onProgress: (f) => document.documentElement.style.setProperty('--catchup', String(f)),
  });
  if (plan.simulate > 0) console.info(`terrarium: caught up ${(plan.simulate / 3600).toFixed(1)} h of ship life`);

  const listeners = new Set();
  const runner = new LiveRunner({
    state, data,
    onEvents: (evs) => {
      journal.append(evs).catch((e) => console.warn('terrarium: journal write failed', e));
      for (const fn of listeners) fn(evs);
    },
  });
  runner.start();

  const save = () => { try { snapshots.save(runner.state); } catch (e) { console.warn('terrarium: save failed', e); } };
  setInterval(save, data.config.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else runner.pump(); });
  window.addEventListener('pagehide', save);

  // Hidden backup shortcuts: Ctrl+Alt+Shift+E export, Ctrl+Alt+Shift+I import.
  window.addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyE') {
      e.preventDefault();
      const blob = new Blob([buildBackup(runner.state, await journal.all())], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `terrarium-backup-${Date.now()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (e.code === 'KeyI') {
      e.preventDefault();
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
      input.onchange = async () => {
        try {
          const { state: restored, events } = parseBackup(await input.files[0].text(), data);
          runner.stop();
          snapshots.save(restored);
          await journal.replaceAll(events);
          location.reload(); // reboot through the normal catch-up path
        } catch (err) {
          console.error('terrarium: import failed', err);
        }
      };
      input.click();
    }
  });

  // Devtools handle (read-only by convention: the viewer never steers the traveler).
  window.terrarium = { data, runner, journal, get state() { return runner.state; }, onEvents: (fn) => listeners.add(fn) };

  if (params.has('debug')) {
    const { mountInspector } = await import('./dev/inspector.js');
    mountInspector(window.terrarium);
  }
}

main().catch((err) => console.error('terrarium: boot failed', err));
