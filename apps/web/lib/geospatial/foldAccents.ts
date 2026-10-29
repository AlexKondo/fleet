/**
 * Text sent to Google as the person's search words, without accents ("fábrica da GWM" -> "fabrica da GWM"): a place is often registered
 * without them, and an accent must never be the reason a place is not found. The answers keep their own spelling (labels shown to the person).
 */
export function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
}
