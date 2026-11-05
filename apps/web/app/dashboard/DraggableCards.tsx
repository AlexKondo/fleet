"use client";

import { Children, isValidElement, useEffect, useRef, useState, type DragEvent, type ReactElement, type ReactNode } from "react";
import { mergeCardOrder, moveCard, orderToSave } from "@/lib/dashboard/cardOrder";

type Card = ReactElement<{ "data-card": string }>;

/** A press that starts on one of these is using the card, not moving it. */
const CONTROLS = "input,textarea,select,button,a,label";

/**
 * A grid whose cards can be dragged into another order. Each child is an `<li draggable data-card={id}>`. The order is one person's preference on this
 * browser (localStorage), so nothing depends on it: without it the page order is shown. Dragging needs a mouse: touch screens keep the page order.
 */
export function DraggableCards({ storageKey, className, children }: { storageKey: string; className?: string; children: ReactNode }) {
  const cards = Children.toArray(children).filter((c): c is Card => isValidElement(c));
  const ids = cards.map((c) => c.props["data-card"]);
  const [saved, setSaved] = useState<unknown[]>([]);
  const pressed = useRef<HTMLElement | null>(null);
  const dragged = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored)) setSaved(stored);
    } catch {
      // no storage, or something unreadable in it: the page order stands
    }
  }, [storageKey]);

  const order = mergeCardOrder(saved, ids);
  const byId = new Map(cards.map((c) => [c.props["data-card"], c]));
  const cardOf = (event: DragEvent) => (event.target as HTMLElement).closest<HTMLElement>("[data-card]");
  const clearMarks = (root: HTMLElement) =>
    root.querySelectorAll<HTMLElement>("[data-dragging],[data-over]").forEach((el) => {
      delete el.dataset.dragging;
      delete el.dataset.over;
    });

  return (
    <ul
      className={className}
      onPointerDown={(e) => {
        pressed.current = e.target as HTMLElement;
      }}
      onDragStart={(e) => {
        const card = cardOf(e);
        if (!card || pressed.current?.closest(CONTROLS)) {
          e.preventDefault();
          return;
        }
        dragged.current = card.dataset.card ?? null;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragged.current ?? "");
        card.dataset.dragging = "";
      }}
      onDragOver={(e) => {
        const card = cardOf(e);
        if (!card || !dragged.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (card.dataset.card === dragged.current || card.dataset.over !== undefined) return;
        e.currentTarget.querySelectorAll<HTMLElement>("[data-over]").forEach((el) => delete el.dataset.over);
        card.dataset.over = "";
      }}
      onDrop={(e) => {
        const target = cardOf(e)?.dataset.card;
        const from = dragged.current;
        if (!target || !from) return;
        e.preventDefault();
        const next = orderToSave(moveCard(order, from, target), saved);
        setSaved(next);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage blocked: the new order lasts until the page is reloaded
        }
      }}
      onDragEnd={(e) => {
        dragged.current = null;
        clearMarks(e.currentTarget);
      }}
    >
      {order.map((id) => byId.get(id))}
    </ul>
  );
}
