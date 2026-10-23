/**
 * Same as `fmt` in lib/i18n/areaText.ts, copied here so client components can use it without importing that module
 * (it pulls in next/headers through getLocale, which a client bundle must not contain).
 */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
