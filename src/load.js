// Fetches the /data JSON tables in the browser.
import { prepareData, DATA_FILES } from './sim/index.js';

export async function fetchJson(name) {
  const res = await fetch(new URL(`../data/${name}.json`, import.meta.url));
  if (!res.ok) throw new Error(`failed to load data/${name}.json`);
  return res.json();
}

export async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (k) => { raw[k] = await fetchJson(k); }));
  return prepareData(raw);
}
