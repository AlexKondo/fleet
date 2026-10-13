"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Topbar search (Ctrl+K / Cmd+K): a simple, REAL navigation search over the destinations of the app's own menu (the same
 * items the current role sees). It does not search data (vehicles, carpools, places): only pages. ARIA 1.2 combobox with
 * arrows / Enter / Esc, and an empty query lists every destination.
 */
export function GlobalSearch({ items, dict }: { items: { href: string; label: string }[]; dict: Dictionary }) {
  const c = dict.chrome;
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // "Ctrl+K" on Windows/Linux, "⌘K" on Mac: decided after mount (the server render always says Ctrl+K: no hydration mismatch).
  const [hint, setHint] = useState("Ctrl+K");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || "")) setHint("⌘K");
  }, []);

  const needle = fold(query.trim());
  const results = items.filter((i) => !needle || fold(i.label).includes(needle));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        // do not hijack the browser shortcut while the user is typing in some OTHER field
        const t = e.target as HTMLElement | null;
        const editable = Boolean(t) && (t!.tagName === "INPUT" || t!.tagName === "TEXTAREA" || t!.tagName === "SELECT" || t!.isContentEditable);
        if (editable && t !== inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  }

  const activeId = open && results[active] ? `${listId}-o${active}` : undefined;

  return (
    <div
      className="fm-search-box"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <svg className="fm-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-4.2-4.2" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={c.searchLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder={c.searchPlaceholder}
        className="fm-search-input"
        value={query}
        data-testid="fm-global-search"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            if (results.length) setActive((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (results.length) setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            const r = results[active];
            if (open && r) {
              e.preventDefault();
              go(r.href);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      <kbd className="fm-search-kbd" aria-hidden="true">
        {hint}
      </kbd>
      <div className="fm-search-pop" hidden={!open}>
        <ul id={listId} role="listbox" aria-label={c.searchResultsLabel} className="fm-search-list">
          {open && results.length === 0 ? (
            <li role="presentation" className="fm-search-empty">
              {c.searchNoResults}
            </li>
          ) : null}
          {open
            ? results.map((r, i) => (
                <li
                  key={r.href}
                  id={`${listId}-o${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active ? "true" : undefined}
                  className="fm-search-opt"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.href)}
                >
                  {r.label}
                </li>
              ))
            : null}
        </ul>
      </div>
    </div>
  );
}
