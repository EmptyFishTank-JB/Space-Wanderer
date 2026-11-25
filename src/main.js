// Browser entry point: load data, restore + catch up the traveler, run the
// sim live at 1:1, persist continuously, and open the observation window.
// Append ?debug to the URL for a developer inspector (not part of the experience).
import { bootSimulation, LiveRunner } from './sim/index.js';
import { loadData, fetchJson } from './load.js';
import { SnapshotStore, MemoryStorage } from './persist/snapshot.js';
import { IndexedDBJournal, MemoryJournal } from './persist/journal.js';
import { buildBackup, importVoyage } from './persist/backup.js';
import { TerrariumRenderer } from './render/app.js';
import { mountSwitcher } from './ui/switcher.js';
import { AudioEngine } from './audio/engine.js';
import { mountSound } from './ui/sound.js';
import { mountCaptions } from './ui/captions.js';
import { mountTelemetry } from './ui/telemetry.js';

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
  const [data, cameras] = await Promise.all([loadData(), fetchJson('cameras')]);
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

  // the observation window
  const canvas = document.getElementById('feed');
  let switcher = null;
  const audio = new AudioEngine({ data, cameras });
  const captions = cameras.captions === false ? null : mountCaptions();
  const telemetry = mountTelemetry({ canvas });
  const renderer = new TerrariumRenderer({
    canvas, runner, data, cameras,
    onFeedChange: (f) => switcher && switcher.setActive(f),
    onFrame: (fr) => {
      try { audio.update(fr); } catch (e) { console.warn('terrarium: audio frame failed', e); }
      if (captions) captions.update(fr);
      try { telemetry.update(fr); } catch (e) { console.warn('terrarium: telemetry frame failed', e); }
    },
  });
  listeners.add((evs) => { renderer.push(evs); audio.push(evs); });
  switcher = mountSwitcher({ director: renderer.director, cameras, canvas, telemetry });
  mountSound({ audio });
  renderer.start();

  // `frozen` stops autosave/pagehide from writing the old voyage over an import in progress
  let frozen = false;
  const save = () => { if (frozen) return; try { snapshots.save(runner.state); } catch (e) { console.warn('terrarium: save failed', e); } };
  setInterval(save, data.config.autosaveSeconds * 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else runner.pump(); });
  window.addEventListener('pagehide', save);

  // Hidden backup shortcuts: Ctrl+Alt+Shift+E export, Ctrl+Alt+Shift+I import.
  window.addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyE') {
      e.preventDefault();
      save(); // export the latest checkpoint
      const blob = new Blob([buildBackup(runner.state, await journal.exportArchive())], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `terrarium-backup-${Date.now()}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (e.code === 'KeyI') {
      e.preventDefault();
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
      input.onchange = async () => {
        runner.stop();
        frozen = true;
        try {
          const { partial } = await importVoyage({ text: await input.files[0].text(), data, snapshots, journal });
          if (partial) console.info('terrarium: imported an older backup; systems were rebuilt from the journal and only recent memories survived');
          location.reload(); // reboot through the normal catch-up path
        } catch (err) {
          console.error('terrarium: import failed; the current voyage is unchanged', err);
          frozen = false;
          runner.start();
        }
      };
      input.click();
    }
  });

  // Devtools handle (read-only by convention: the viewer never steers the traveler).
  window.terrarium = { data, runner, journal, renderer, audio, get state() { return runner.state; }, onEvents: (fn) => listeners.add(fn) };

  if (params.has('debug')) {
    const { mountInspector } = await import('./dev/inspector.js');
    mountInspector(window.terrarium);
  }
}

main().catch((err) => console.error('terrarium: boot failed', err));
