"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { OPEN_CHAT_EVENT, type OpenChatDetail } from "../ChatWidget";

function open(detail: OpenChatDetail) {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
}

/** Where the viewer left the assistant (a per-viewer convenience only; the page works without it). */
const POS_KEY = "fleet.assistant-pos.v1";
/** The speech bubble can be closed with its x; the choice is remembered in this browser. */
const BUBBLE_KEY = "fleet.assistant-bubble.v1";
type Pos = { x: number; y: number };

/**
 * "Falar com o FleetMind" (bottom of the sidebar): the robot mascot, its caption, the mic button and the example phrases all
 * OPEN the existing chat assistant (ChatWidget listens for OPEN_CHAT_EVENT; nothing is duplicated). The robot is the same
 * picture and float animation the floating mascot had (animate-chat-agent-float); the floating chat button and mascot are
 * gone on these pages. The mic starts the assistant's own voice capture; a phrase pre-fills its message box.
 */
export function AssistantPanel({ dict }: { dict: Dictionary }) {
  const c = dict.chrome;
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(true);
  const posRef = useRef<Pos | null>(null);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean; id: number } | null>(null);
  const swallowClick = useRef(false);
  const clamp = (x: number, y: number): Pos => {
    const w = ref.current?.offsetWidth ?? 216;
    const h = ref.current?.offsetHeight ?? 160;
    return { x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)), y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)) };
  };
  const place = (p: Pos | null) => { posRef.current = p; setPos(p); };
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Pos>) : null;
      if (p && typeof p.x === "number" && typeof p.y === "number") place(clamp(p.x, p.y));
    } catch { /* no saved place: the default corner */ }
    try { if (window.localStorage.getItem(BUBBLE_KEY) === "closed") setBubbleOpen(false); } catch { /* the bubble stays open */ }
    const onResize = () => { if (posRef.current) place(clamp(posRef.current.x, posRef.current.y)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The whole panel is the handle (the robot and the title too), except its buttons other than the robot: a press that moves more than a few pixels drags it
  // anywhere on the screen; a press that does not move is a normal click (the robot still opens the chat).
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button") && !t.closest("[data-drag]")) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      d.moved = true;
      try { e.currentTarget.setPointerCapture(d.id); } catch { /* the drag still follows the pointer events */ }
    }
    place(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 0);
    try { window.localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* not saved */ }
  };
  const openChat = (detail: OpenChatDetail) => { if (!swallowClick.current) open(detail); };
  const closeBubble = () => {
    setBubbleOpen(false);
    try { window.localStorage.setItem(BUBBLE_KEY, "closed"); } catch { /* not remembered */ }
  };
  const examples = [c.assistantExample1, c.assistantExample2, c.assistantExample3, c.assistantExample4];
  return (
    <section
      ref={ref}
      className="fm-assist fm-float"
      aria-labelledby="fm-assist-title"
      data-testid="fm-assistant-panel"
      data-moved={pos ? "true" : undefined}
      data-bubble={bubbleOpen ? "open" : "closed"}
      style={pos ? { left: pos.x, top: pos.y, bottom: "auto" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <h2 id="fm-assist-title" className="fm-assist-title">
        {c.assistantTitle}
      </h2>
      <div className="fm-assist-row">
        <button type="button" className="fm-assist-robot" data-drag aria-label={c.assistantTitle} onClick={() => openChat({})} data-testid="fm-assistant-robot">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static illustration, next/image is overkill here */}
          <img src="/illustrations/fleet-agent.jpg" alt="" className="fm-assist-img h-14 w-14 rounded-full border-2 border-gwm-accent object-cover" />
        </button>
        {bubbleOpen ? (
          <div className="fm-assist-bubble">
            <button type="button" className="fm-assist-caption" data-drag title={dict.chat.voiceHint} onClick={() => openChat({})} data-testid="fm-assistant-caption">
            {dict.chat.voiceHint}
          </button>
            <button type="button" className="fm-assist-x" aria-label={dict.common.close} title={dict.common.close} onClick={closeBubble} data-testid="fm-assistant-close">
              ×
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" className="fm-assist-mic" aria-label={c.assistantMic} title={c.assistantMic} onClick={() => openChat({ voice: true })} data-testid="fm-assistant-mic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
      </button>
      <ul className="fm-assist-examples" aria-label={c.assistantExamplesLabel}>
        {examples.map((text) => (
          <li key={text}>
            <button type="button" className="fm-assist-example" onClick={() => openChat({ draft: text })}>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
