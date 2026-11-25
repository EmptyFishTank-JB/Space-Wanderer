// Public surface of the headless simulation (zero DOM dependencies).
export { prepareData, DATA_FILES } from './data.js';
export { createInitialState, STATE_VERSION } from './state.js';
export { step, run } from './engine.js';
export { catchUp, catchUpSync, planCatchup } from './catchup.js';
export { LiveRunner } from './runner.js';
export { bootSimulation } from './boot.js';
export { drain, NOTABLE } from './events.js';
export { shipHour, missionDay, missionYear, formatShipTime } from './clock.js';
export { trayStage } from './ship/hydroponics.js';
export { pantryDays } from './ship/food.js';
export { gait } from './traveler/physiology.js';
export { ACTIONS } from './ai/actions.js';
