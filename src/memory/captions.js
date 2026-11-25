// Subtitle-style captions for a log entry being written (spec §4): they
// exist only while the traveler is actually typing, and only when the camera
// is in the room where they are typing. Returns the sentence in progress,
// typed up to the current character.

export function writingProgress(state) {
  const a = state.traveler.activity;
  if (!a || a.id !== 'write_log' || a.phase !== 'perform' || state.traveler.move || !a.params.text) return null;
  const total = a.params.text.length;
  // a pause to think before the first words, then steady typing
  const u = Math.max(0, Math.min(1, (a.elapsed - 20) / Math.max(1, a.duration - 60)));
  return { a, chars: Math.floor(total * u), total };
}

export function captionFor(state, viewingRoom) {
  const p = writingProgress(state);
  if (!p || state.traveler.pos.room !== viewingRoom) return null;
  const sentences = p.a.params.sentences || [p.a.params.text];
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const end = start + s.length;
    if (p.chars <= end || i === sentences.length - 1) {
      const typed = s.slice(0, Math.max(0, p.chars - start));
      return { index: i, of: sentences.length, header: i === 0 ? p.a.params.header : null, text: typed, full: s, done: typed.length >= s.length };
    }
    start = end + 1; // the joining space
  }
  return null;
}
