const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * ISO 8601 → Date. По контракту внешний API отдаёт время в UTC,
 * но иногда без указателя зоны ("2026-03-01T00:40:39") — такие строки тоже считаем UTC.
 */
export function parseUtc(raw: unknown): Date {
  if (typeof raw !== "string") throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  const s = raw.trim();
  const d = new Date(HAS_ZONE.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${JSON.stringify(raw)}`);
  return d;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

/** Все даты от from до to включительно. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
