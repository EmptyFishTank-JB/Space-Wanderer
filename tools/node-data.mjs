// Node-side loader for the /data JSON files (the browser uses fetch instead).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData, DATA_FILES } from '../src/sim/data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadRawData() {
  const raw = {};
  for (const k of DATA_FILES) raw[k] = JSON.parse(readFileSync(join(root, 'data', `${k}.json`), 'utf8'));
  return raw;
}

export function loadData() {
  return prepareData(loadRawData());
}
