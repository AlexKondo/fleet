/**
 * The trip from the "Veículos que precisam de atenção" number to those vehicles' cards: the page starts slowly, speeds up, slows down and stops with
 * the cards in the middle of the screen. Then each of those cards flares its orange glow and gives a small shake (data-arrived, styled in fm-ops.css).
 * The cards are found by data-attention, set from the same rule as the number (app/dashboard/attention.ts).
 */

/** Slow start, fast middle, slow stop (cubic ease-in-out): 0 gives 0, 1 gives 1. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** A longer trip takes a little longer, never so long that the page feels stuck. */
export function scrollDuration(distance: number): number {
  return Math.round(Math.min(1400, Math.max(600, 500 + Math.abs(distance) * 0.45)));
}

export interface StopInput {
  /** top of the cards, relative to the visible area */
  top: number;
  height: number;
  scrollY: number;
  /** height of the visible area */
  viewport: number;
  /** what the fixed top bar covers at the top of the visible area */
  topBar: number;
  maxScroll: number;
}

/**
 * Where the page stops: the cards in the middle of what is visible under the fixed top bar. When they do not fit, the first row just under the bar.
 * Never past either end of the page.
 */
export function scrollStop({ top, height, scrollY, viewport, topBar, maxScroll }: StopInput): number {
  const room = viewport - topBar;
  const gap = height + 32 > room ? 16 : (room - height) / 2;
  return Math.round(Math.min(Math.max(0, maxScroll), Math.max(0, scrollY + top - topBar - gap)));
}

const CANCEL_ON = ["wheel", "touchstart", "keydown"] as const;
let cancelRunning: (() => void) | null = null;

/** Takes the page to the section's cards that need attention (to the section itself when none does), then marks them as arrived. */
export function jumpToAttention(section: HTMLElement): void {
  cancelRunning?.();
  const cards = Array.from(section.querySelectorAll<HTMLElement>('[data-card][data-attention="true"]'));
  const rects = (cards.length ? cards : [section]).map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const bar = document.querySelector<HTMLElement>(".fm-topbar");
  const from = window.scrollY;
  const to = scrollStop({
    top,
    height: bottom - top,
    scrollY: from,
    viewport: window.innerHeight,
    topBar: bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
  });
  if (Math.abs(to - from) < 2) {
    arrive(cards);
    return;
  }

  const duration = scrollDuration(to - from);
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of CANCEL_ON) window.removeEventListener(type, stop);
    if (cancelRunning === stop) cancelRunning = null;
  };
  // the person scrolling on their own takes over: the trip stops where it is, with no flare and no shake
  for (const type of CANCEL_ON) window.addEventListener(type, stop, { passive: true });
  cancelRunning = stop;

  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    window.scrollTo({ top: from + (to - from) * easeInOut(t), behavior: "instant" });
    if (t < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    stop();
    arrive(cards);
  };
  frame = requestAnimationFrame(step);
}

function arrive(cards: HTMLElement[]): void {
  for (const card of cards) {
    card.removeAttribute("data-arrived");
    void card.offsetWidth; // restarts the flare and the shake when the number is clicked again
    card.setAttribute("data-arrived", "");
    card.onanimationend = (event) => {
      if (event.target === card && event.animationName === "cc-attn-flare") card.removeAttribute("data-arrived");
    };
  }
  // keyboard users land on the first card, not back at the top of the page
  const first = cards[0];
  if (first) {
    if (!first.hasAttribute("tabindex")) first.tabIndex = -1;
    first.focus({ preventScroll: true });
  }
}
