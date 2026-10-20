"use client";

import type { Dictionary } from "@/lib/i18n/dictionaries";
import { OPEN_CHAT_EVENT, type OpenChatDetail } from "../ChatWidget";

function open(detail: OpenChatDetail) {
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
}

/**
 * "Falar com o FleetMind" (bottom of the sidebar): the robot mascot, its caption, the mic button and the example phrases all
 * OPEN the existing chat assistant (ChatWidget listens for OPEN_CHAT_EVENT; nothing is duplicated). The robot is the same
 * picture and float animation the floating mascot had (animate-chat-agent-float); the floating chat button and mascot are
 * gone on these pages. The mic starts the assistant's own voice capture; a phrase pre-fills its message box.
 */
export function AssistantPanel({ dict }: { dict: Dictionary }) {
  const c = dict.chrome;
  const examples = [c.assistantExample1, c.assistantExample2, c.assistantExample3, c.assistantExample4];
  return (
    <section className="fm-assist" aria-labelledby="fm-assist-title" data-testid="fm-assistant-panel">
      <h2 id="fm-assist-title" className="fm-assist-title">
        {c.assistantTitle}
      </h2>
      <div className="fm-assist-row">
        <button type="button" className="fm-assist-robot" aria-label={c.assistantTitle} onClick={() => open({})} data-testid="fm-assistant-robot">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static illustration, next/image is overkill here */}
          <img src="/illustrations/fleet-agent.jpg" alt="" className="animate-chat-agent-float h-14 w-14 rounded-full border-2 border-gwm-accent object-cover" />
        </button>
        <button type="button" className="fm-assist-caption" onClick={() => open({})} data-testid="fm-assistant-caption">
          {dict.chat.voiceHint}
        </button>
      </div>
      <button type="button" className="fm-assist-mic" aria-label={c.assistantMic} title={c.assistantMic} onClick={() => open({ voice: true })} data-testid="fm-assistant-mic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
      </button>
      <ul className="fm-assist-examples" aria-label={c.assistantExamplesLabel}>
        {examples.map((text) => (
          <li key={text}>
            <button type="button" className="fm-assist-example" onClick={() => open({ draft: text })}>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
