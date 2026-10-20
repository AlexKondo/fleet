"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type CommandSearchItem = { label: string; detail: string; href: string };
export function CommandSearch({ items }: { items: CommandSearchItem[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        const el = e.target as HTMLElement | null;
        if (
          el &&
          el !== input.current &&
          (el.matches("input,textarea,select") || el.isContentEditable)
        )
          return;
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const results = items
    .filter((i) => fold(`${i.label} ${i.detail}`).includes(fold(query.trim())))
    .slice(0, 8);
  return (
    <div
      className="fc-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <span aria-hidden="true">⌕</span>
      <input
        ref={input}
        type="search"
        aria-label="Buscar veículo ou viagem do período e local selecionados"
        placeholder="Buscar veículo, viagem, placa, motorista..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <kbd>Ctrl + K</kbd>
      {open && (
        <div className="fc-search-results">
          <p>Veículos e viagens do filtro atual</p>
          <ul>
            {results.map((i, index) => (
              <li key={`${i.href}-${index}`}>
                <Link href={i.href} onClick={() => setOpen(false)}>
                  <strong>{i.label}</strong>
                  <small>{i.detail}</small>
                </Link>
              </li>
            ))}
          </ul>
          {!results.length && (
            <p role="status">Nenhum resultado neste filtro.</p>
          )}
        </div>
      )}
    </div>
  );
}
