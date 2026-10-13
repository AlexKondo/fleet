"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { fillTemplate } from "@/lib/carpool/errorText";
import type { PlaceAutocompleteResult } from "./placeAutocompleteActions";
import type { PlaceSuggestion } from "@/lib/geospatial/placeAutocomplete";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import "./placeAutocomplete.css";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 3;

/**
 * Accessible address combobox (WAI-ARIA 1.2 combobox with a listbox popup) fed by the server-side Places autocomplete
 * (suggestPlaces: session-bound, capped per user and per org, key never in the browser). Controlled: the parent owns the
 * text. Free typing always works: a suggestion only fills the text, and any failure of the suggestions is silent (no list).
 * One session token per typing session (crypto.randomUUID), reset after a selection. Stale answers are ignored.
 */
export function PlaceAutocomplete({
  id,
  name,
  value,
  onChange,
  dict,
  label,
  placeholder,
  required,
  maxLength = 300,
  className = "fm-input",
  icon,
  clearLabel,
  testId,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  dict: Dictionary;
  /** Accessible name when no visible <label htmlFor> exists. */
  label?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
  /** Decorative leading icon (the input gets extra left padding). */
  icon?: React.ReactNode;
  /** Shows the clear (x) button with this accessible label when the field has text. */
  clearLabel?: string;
  testId?: string;
}) {
  const t = dict.placeAutocomplete;
  const listId = useId();
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  // Popover placement: below the field, limited so it never runs under the bottom bar / chat button (mobile), else flipped above.
  const [pos, setPos] = useState<{ above: boolean; max: number }>({ above: false, max: 320 });
  const tokenRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // An answer that arrives after the user left the field must not pop a list open under another field.
  const focusedRef = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestRef.current++;
      abortRef.current?.abort();
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = document.getElementById(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const reserve = window.innerWidth < 768 ? 150 : 24; // bottom nav + floating chat button on mobile
      const below = window.innerHeight - r.bottom - reserve - 8;
      const aboveSpace = r.top - 70 - 8;
      if (below >= 180 || below >= aboveSpace) setPos({ above: false, max: Math.max(120, Math.min(320, below)) });
      else setPos({ above: true, max: Math.max(120, Math.min(320, aboveSpace)) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [open, items, id]);

  function cancelPending() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    requestRef.current++; // any in-flight answer is now stale
    abortRef.current?.abort(); // ...and the browser really drops the request
    abortRef.current = null;
    setLoading(false);
  }

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function handleInput(next: string) {
    onChange(next);
    cancelPending();
    if (next.trim().length < MIN_CHARS) {
      setItems([]);
      close();
      return;
    }
    timerRef.current = setTimeout(() => {
      const mine = ++requestRef.current;
      tokenRef.current ??= crypto.randomUUID();
      setLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      fetch("/api/geo/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: next, sessionToken: tokenRef.current }),
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      })
        .then((r) => (r.ok ? (r.json() as Promise<PlaceAutocompleteResult>) : ({ status: "unavailable", reason: "unavailable" } as PlaceAutocompleteResult)))
        .then((res) => {
          if (mine !== requestRef.current) return; // stale
          setLoading(false);
          if (res.status === "ok" && res.suggestions.length > 0 && focusedRef.current) {
            setItems(res.suggestions);
            setActive(-1);
            setOpen(true);
          } else {
            setItems([]);
            close();
          }
        })
        .catch(() => {
          if (mine !== requestRef.current) return;
          setLoading(false);
          setItems([]);
          close();
        });
    }, DEBOUNCE_MS);
  }

  function select(s: PlaceSuggestion) {
    cancelPending();
    onChange(s.text);
    setItems([]);
    close();
    tokenRef.current = null; // a selection ends the Google session
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : items.length - 1);
        return;
      }
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1)));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && items[active]) {
        e.preventDefault(); // choosing an option must not submit the form
        select(items[active]!);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  const activeId = open && active >= 0 ? `${listId}-o${active}` : undefined;
  const hasGoogle = items.some((s) => s.kind === "place");

  return (
    <div
      ref={rootRef}
      className="fm-ac"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          focusedRef.current = false;
          close();
        }
      }}
    >
      <div className="fm-input-wrap fm-ac-wrap" data-has-icon={icon ? "true" : undefined}>
        {icon ? <span className="fm-ac-icon" aria-hidden="true">{icon}</span> : null}
        <input
          id={id}
          name={name}
          className={className}
          required={required}
          maxLength={maxLength}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-busy={loading}
          data-testid={testId}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {loading ? <span className="fm-ac-spinner" aria-hidden="true" data-testid="ac-loading" /> : null}
        {clearLabel && value && !loading ? (
          <button
            type="button"
            className="fm-clear"
            aria-label={clearLabel}
            onClick={() => {
              cancelPending();
              onChange("");
              setItems([]);
              close();
              tokenRef.current = null;
              (document.getElementById(id) as HTMLInputElement | null)?.focus();
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      <span className="fm-sr-only" role="status" aria-live="polite" data-testid="ac-status">
        {loading ? t.loading : open && items.length > 0 ? (items.length === 1 ? t.availableOne : fillTemplate(t.available, { count: items.length })) : ""}
      </span>
      <div className="fm-ac-pop" hidden={!open} data-above={pos.above ? "true" : undefined}>
        <ul id={listId} role="listbox" aria-label={t.listLabel} className="fm-ac-list" data-testid="ac-list" style={{ maxHeight: pos.max - 34 }}>
          {open
            ? items.map((s, i) => (
                <li
                  key={`${s.kind}-${s.id}`}
                  id={`${listId}-o${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active ? "true" : undefined}
                  data-kind={s.kind}
                  className="fm-ac-opt"
                  // keep focus in the input while choosing (mouse + touch), then fill the text
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(s)}
                >
                  <span className="fm-ac-main">
                    <span className="fm-ac-name">{s.main}</span>
                    {s.kind === "point" ? <span className="fm-badge">{t.pointBadge}</span> : null}
                  </span>
                  {s.secondary ? <span className="fm-ac-sub">{s.secondary}</span> : null}
                </li>
              ))
            : null}
        </ul>
        {open && hasGoogle ? (
          <p className="fm-ac-attr" data-testid="ac-attribution">
            {t.poweredBy}
          </p>
        ) : null}
      </div>
    </div>
  );
}
