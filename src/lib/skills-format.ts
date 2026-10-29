// Popup-side formatting for Google Skills transcripts.
// Kept apart from skills-extractor.ts on purpose: the extractor is bundled into the
// content script, and a module shared with the popup would be split into a separate
// chunk that a classic content script cannot import.

import type { SkillsCue } from './skills-extractor';

export function formatCues(cues: SkillsCue[], includeTimestamps: boolean): string {
  const stamp = (t: number) => {
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    const m = Math.floor((t / 60) % 60).toString().padStart(2, '0');
    const h = Math.floor(t / 3600);
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  };
  return cues
    .map((c) => (includeTimestamps ? `[${stamp(c.time)}] ${c.text}` : c.text))
    .join('\n\n');
}
