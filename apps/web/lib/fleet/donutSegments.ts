export interface DonutPart {
  key: string;
  value: number;
}

export interface DonutSegment {
  key: string;
  value: number;
  /** 0..1 of the whole. */
  share: number;
  /** Painted length along the ring, in the unit of `circumference`. */
  dash: number;
  /** Where the segment starts along the ring. */
  offset: number;
}

const SMALLEST_VISIBLE_DASH = 1;

/**
 * The arcs of a donut. Parts with nothing are left out; a gap separates the segments, except when one part is the whole ring. A tiny part keeps a
 * visible sliver instead of disappearing into the gap.
 */
export function donutSegments(parts: readonly DonutPart[], circumference: number, gap: number): DonutSegment[] {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  const gapEach = shown.length > 1 ? gap : 0;
  let start = 0;
  return shown.map((p) => {
    const share = p.value / total;
    const arc = share * circumference;
    const segment = { key: p.key, value: p.value, share, dash: Math.max(arc - gapEach, SMALLEST_VISIBLE_DASH), offset: start };
    start += arc;
    return segment;
  });
}
