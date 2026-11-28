// The freight lift, working like a lift. At a landing you call it: the car
// comes to your deck and its doors open, and whether you step in is up to
// you. Inside, you pick a deck: the doors close, the car rides the shaft
// (with you in it, the doors shut, so you see only the car), and opens
// again at the deck you picked. The doors close on their own after a while
// if nobody is standing in them. Pure state: no DOM.
const SPEED = 1.4; // m/s
const DOOR_RATE = 1.6; // fully open in well under a second
const HOLD = 8; // seconds the doors stay open

export const liftRoom = (world, car) => world.rooms[car.id];

/** The lift the walker can work from here: inside its car, or standing at one of its landings. */
export function liftNear(world, walker) {
  for (const car of world.lifts) {
    if (walker.room && walker.room.id === car.id) return { car, inside: true };
    if (walker.mode !== 'room' || !walker.room) continue;
    const i = car.stops.findIndex((s) => s.room === walker.room.id);
    if (i < 0) continue;
    const st = car.stops[i];
    if (Math.hypot(walker.x - st.door.at[0], walker.y - st.door.at[1]) < 2.0) return { car, inside: false, stop: i };
  }
  return null;
}

/** Call the car to a landing (or open its doors if it's already there). */
export function callLift(car, i) {
  if (car.at === i && !car.moving) { car.wantDoors = true; car.holdT = HOLD; return 'open'; }
  car.target = i;
  return 'called';
}

/** From inside: ride to a stop. */
export function sendLift(car, i) {
  if (i === car.at && !car.moving) { car.wantDoors = true; car.holdT = HOLD; return 'here'; }
  car.target = i;
  car.wantDoors = false;
  return 'going';
}

/** Run every lift for dt seconds, carrying the walker if they're in a car. */
export function stepLifts(world, walker, dt) {
  for (const car of world.lifts) {
    const room = liftRoom(world, car);
    const riding = walker.room === room;
    // someone standing in the doorway (on that deck) keeps the doors open
    const here = car.stops[car.at];
    const blocked = !car.moving && here && walker.mode === 'room' && (walker.deck === here.deck || riding) && Math.abs(walker.z - here.z) < 0.5 && Math.hypot(walker.x - here.door.at[0], walker.y - here.door.at[1]) < 0.7;
    if (car.moving) {
      const goal = car.stops[car.target].z;
      const dz = goal - car.z;
      const step = Math.sign(dz) * Math.min(Math.abs(dz), SPEED * dt * Math.min(1, 0.3 + Math.abs(dz)));
      car.z += step;
      if (riding) walker.z = car.z;
      if (Math.abs(goal - car.z) < 1e-4) {
        car.z = goal; car.moving = false; car.at = car.target; car.target = null;
        car.dockDeck = car.stops[car.at].deck;
        car.wantDoors = true; car.holdT = HOLD;
        if (riding) { walker.deck = car.dockDeck; walker.z = car.z; }
      }
    } else {
      if (car.target !== null && car.target !== car.at) {
        // doors shut first, then away
        car.wantDoors = false;
        if (car.doors <= 0.001 && !blocked) { car.moving = true; car.dockDeck = null; if (riding) walker.deck = car.deck; }
      } else if (car.target === car.at) car.target = null;
      if (car.wantDoors) { car.holdT -= dt; if (car.holdT <= 0 && !blocked) car.wantDoors = false; }
    }
    const want = car.wantDoors || (blocked && car.doors > 0.5) ? 1 : 0;
    car.doors += Math.sign(want - car.doors) * Math.min(Math.abs(want - car.doors), dt * DOOR_RATE);
    room.z = [car.z, car.z + room.h];
    for (let i = 0; i < car.stops.length; i++) car.stops[i].door.open = !car.moving && car.at === i ? car.doors : 0;
  }
}

/** The stop above or below where the car is now. */
export function nextStop(car, dir) {
  const i = car.at + (dir === 'up' ? 1 : -1);
  return i >= 0 && i < car.stops.length ? i : null;
}
