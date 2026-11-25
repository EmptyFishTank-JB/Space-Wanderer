// What is out of the window right now, and how much it pulls at the traveler.
// Feeds the viewport-gazing utility (lingering in awe) and, in Phase 3, the
// renderer's choice of exterior shots.
import { currentSystem, starDistance } from './flight.js';

export function viewSubject(state, data) {
  const f = state.ship.flight;
  if (f.mode === 'void') return { interest: 0, kind: 'void' };
  if (f.mode === 'hyperspace' || f.mode === 'charging') return { interest: 0.7, kind: 'hyperspace' };
  const sys = currentSystem(state, data);
  if (f.mode === 'scooping') return { interest: 0.8, kind: 'corona', id: 'star', name: sys.star.label };
  if (f.at && ['orbit', 'descent', 'landed', 'ascent'].includes(f.mode)) {
    const b = sys.byId[f.at];
    const parent = b.parent !== 'star' ? sys.byId[b.parent] : null;
    let interest = 0.25 + 0.6 * b.beauty + (parent && parent.rings ? 0.15 : 0);
    if (f.mode === 'descent' || f.mode === 'ascent') interest += 0.15;
    return { interest: Math.min(1, interest), kind: f.mode === 'landed' ? 'horizon' : 'body', id: b.id, name: b.name };
  }
  const radii = starDistance(state, data) / sys.star.radius;
  if (radii < 40) return { interest: 0.2 + 0.5 * sys.star.beauty * (1 - radii / 40), kind: 'star', id: 'star', name: sys.star.label };
  if (f.mode === 'cruise') return { interest: 0.3, kind: 'cruise', id: f.target && f.target.body };
  return { interest: 0.15, kind: 'starfield' };
}
