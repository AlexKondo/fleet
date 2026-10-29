"use client";

import { useState } from "react";

export interface ShareAddressTexts {
  title: string; share: string; maps: string; waze: string; copy: string; copied: string; shareText: string;
}

/** The destination of a confirmed reservation, ready to take to a navigation app: the phone's share sheet (WhatsApp, Maps, Waze...), Google Maps, Waze, or copy. */
export function ShareAddress({ address, T }: { address: string; T: ShareAddressTexts }) {
  const [copied, setCopied] = useState(false);
  const q = encodeURIComponent(address);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  const wazeUrl = `https://waze.com/ul?q=${q}&navigate=yes`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function share() {
    try {
      await navigator.share({ text: T.shareText.replace("{address}", address), url: mapsUrl });
    } catch {
      /* the person closed the share sheet */
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <section className="fm-card rd-share" aria-label={T.title} data-testid="share-address">
      <h2 className="rd-share-title">{T.title}</h2>
      <p className="rd-meta break-user-text">{address}</p>
      <div className="rd-share-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {canShare ? <button type="button" className="fm-btn" onClick={share} data-testid="share-native">{T.share}</button> : null}
        <a className="fm-btn fm-btn-ghost" href={mapsUrl} target="_blank" rel="noopener noreferrer" data-testid="share-maps">{T.maps}</a>
        <a className="fm-btn fm-btn-ghost" href={wazeUrl} target="_blank" rel="noopener noreferrer" data-testid="share-waze">{T.waze}</a>
        <button type="button" className="fm-btn fm-btn-ghost" onClick={copy} data-testid="share-copy">{T.copy}</button>
      </div>
      <p role="status" className="rd-meta" style={{ minHeight: 18 }}>{copied ? T.copied : ""}</p>
    </section>
  );
}
