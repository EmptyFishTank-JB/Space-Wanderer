// Quiet captions under the feed while a log entry is being written. They
// fade in and out softly and are never shown otherwise.
import { captionFor } from '../memory/captions.js';

export function mountCaptions() {
  const el = document.createElement('div');
  el.className = 'caption';
  el.setAttribute('aria-live', 'off');
  const head = document.createElement('div');
  head.className = 'caption-head';
  const body = document.createElement('div');
  body.className = 'caption-body';
  el.append(head, body);
  document.body.appendChild(el);
  let lastIndex = -1;
  let holdUntil = 0;
  return {
    update(fr) {
      const room = fr.feedDef && fr.feedDef.room;
      const c = room ? captionFor(fr.state, room) : null;
      const now = fr.t;
      if (c) {
        if (c.index !== lastIndex) { lastIndex = c.index; }
        head.textContent = c.header ? `LOG · ${c.header}` : '';
        body.textContent = c.text;
        el.classList.add('shown');
        holdUntil = now + 4;
      } else if (now > holdUntil) {
        el.classList.remove('shown');
        lastIndex = -1;
      }
    },
  };
}
