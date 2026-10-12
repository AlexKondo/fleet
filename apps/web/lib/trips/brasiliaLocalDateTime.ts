/**
 * The trip form's <input type="datetime-local"> yields "YYYY-MM-DDTHH:mm" with NO time zone. `new Date(thatString)` reads it in the
 * RUNTIME's zone: correct in a Brasília browser, but 3 hours off on Vercel's Node runtime (UTC), which evaluated the plan step
 * (vehicle availability window, carpool matching window, traffic restriction) 3 hours before what the user typed. The fleet works in
 * Brasília time (formatDateTime pins America/Sao_Paulo; Brazil has had no daylight saving since 2019, so the offset is a constant
 * -03:00), so a zone-less value is read as Brasília time regardless of where the code runs. Values that already carry an offset
 * ("Z" or "+hh:mm") are left to the normal parser.
 */
const NAIVE_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

export function parseBrasiliaLocalDateTime(value: string): Date {
  const trimmed = value.trim();
  const match = NAIVE_LOCAL.exec(trimmed);
  if (!match) return new Date(trimmed);
  return new Date(`${match[1]}T${match[2]}:${match[3] ?? "00"}-03:00`);
}
