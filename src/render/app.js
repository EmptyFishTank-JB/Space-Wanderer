// Browser renderer: owns the visible canvas, the 320×180 framebuffer and the
// frame loop. Reads the live sim (never writes it), asks the director which
// feed to show, and blits at the largest whole-number scale that fits.
import { W, H, PPM, rect } from './gfx.js';
import { Director, interestingRooms, EVA } from './director.js';
import { spaceView } from './spaceview.js';
import { TravelerTracker } from './actor.js';
import { renderRoomFeed } from './feed.js';
import { renderExteriorFeed } from './exterior.js';
import { renderEvaFeed, evaActive } from './eva.js';
import { renderRoverFeed, roverActive } from './rover.js';
import { renderPortFeed, ashore } from './port.js';
import { makeCanvas } from './celestial.js';
import { picks } from './picks.js';

export function renderFeed(ctx, feedId, m, director) {
  picks.begin();
  const def = director.feedDef(feedId);
  if (feedId === EVA) return renderEvaFeed(ctx, m);
  if (def.rover) return renderRoverFeed(ctx, m);
  if (def.port) return renderPortFeed(ctx, m);
  if (def.exterior) return renderExteriorFeed(ctx, m, def);
  const roomW = m.data.rooms[def.room].width;
  const here = m.pos.room === def.room;
  const camX = m.camX ?? director.cameraX(feedId, roomW, m.pos.x * PPM, m.dt, here);
  return renderRoomFeed(ctx, { ...m, room: def.room, camX, feed: def, feeds: director.feeds });
}

export class TerrariumRenderer {
  constructor({ canvas, runner, data, cameras, onFeedChange, onFrame }) {
    this.canvas = canvas;
    this.runner = runner;
    this.data = data;
    this.cameras = cameras;
    this.fb = makeCanvas(W, H);
    this.fbx = this.fb.getContext('2d', { willReadFrequently: true });
    this.director = new Director(cameras);
    this.tracker = new TravelerTracker();
    this.events = [];
    this.onFeedChange = onFeedChange;
    this.onFrame = onFrame;
    this.last = null;
    this.feed = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Sim events arrive here (the director reacts to some of them). */
  push(events) { for (const e of events) this.events.push(e); if (this.events.length > 500) this.events.splice(0, this.events.length - 500); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / W, (innerHeight * dpr) / H)));
    this.canvas.width = W * scale;
    this.canvas.height = H * scale;
    this.canvas.style.width = `${(W * scale) / dpr}px`;
    this.canvas.style.height = `${(H * scale) / dpr}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    this.scale = scale;
  }

  start() {
    const frame = () => {
      try { this.frame(); } catch (err) { console.error('terrarium: render error', err); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  frame() {
    const now = performance.now() / 1000;
    const dt = this.last === null ? 0 : Math.min(0.1, now - this.last);
    this.last = now;
    const state = this.runner.state;
    if (this.runner.catchingUp) return; // still catching up: the screen stays dark
    const alpha = this.runner.alpha();
    const pos = this.tracker.update(state, alpha, now);
    const tr = state.traveler;
    const events = this.events;
    this.events = [];
    const feed = this.director.update(now, {
      travelerRoom: pos.room, eva: evaActive(state), rover: roverActive(state), port: ashore(state), events, shipMode: state.ship.flight.mode, heat: state.ship.thermal.heat,
      travelerStill: !tr.move && tr.activity && tr.activity.phase === 'perform', interestingRooms: interestingRooms(state),
    });
    if (feed !== this.feed) { this.feed = feed; if (this.onFeedChange) this.onFeedChange(feed); }
    const view = spaceView(state, this.data);
    view.chart = !!this.chart; // telemetry on: the star chart overlay
    renderFeed(this.fbx, feed, { state, data: this.data, view, t: now, alpha, pos, tracker: this.tracker, dt }, this.director);
    if (this.onFrame) this.onFrame({ state, data: this.data, feedId: feed, feedDef: this.director.feedDef(feed), pos, tracker: this.tracker, view, t: now, dt });
    const fade = this.director.fadeAmount(now);
    if (fade > 0) rect(this.fbx, [0, 0, 0], 0, 0, W, H, fade);
    const ctx = this.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fb, 0, 0, this.canvas.width, this.canvas.height);
  }
}
