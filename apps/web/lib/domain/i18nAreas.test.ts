import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../i18n/locales";

/** Every area text file: the 4 languages define the same keys, no empty text, the same {placeholders}. */
const dir = path.resolve(__dirname, "../i18n/areas");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(",");

describe("area texts", () => {
  for (const file of files) {
    it(`${file}: complete in every language`, async () => {
      const mod = (await import(`../i18n/areas/${file.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
      const areas = Object.entries(mod).filter(([, v]) => v && typeof v === "object" && "pt-BR" in (v as object));
      expect(areas.length, "the file must export at least one AreaTexts").toBeGreaterThan(0);
      for (const [name, value] of areas) {
        const texts = value as Record<string, Record<string, string>>;
        const base = texts["pt-BR"]!;
        for (const locale of LOCALES) {
          const t = texts[locale];
          expect(t, `${name}.${locale}`).toBeDefined();
          expect(Object.keys(t!).sort(), `${name}.${locale} keys`).toEqual(Object.keys(base).sort());
          for (const [k, v] of Object.entries(t!)) {
            expect(typeof v === "string" && v.trim().length > 0, `${name}.${locale}.${k} empty`).toBe(true);
            expect(placeholders(v), `${name}.${locale}.${k} placeholders`).toBe(placeholders(base[k]!));
          }
        }
      }
    });
  }
});
