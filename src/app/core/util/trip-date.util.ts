import { Timestamp } from '@angular/fire/firestore';

/**
 * Calendar-day helpers.
 *
 * Trip start/end dates and activity dates are *calendar days*, not instants —
 * "Aug 25" should be Aug 25 for everyone, regardless of timezone. But a JS Date
 * / Firestore Timestamp is an absolute instant, so storing a picked day as
 * "local midnight" and re-reading it in a different timezone shifts the day
 * (and can drop the first/last day of a trip).
 *
 * Convention: a calendar day is stored at **UTC midnight** of that day. Writes
 * normalize to UTC midnight; reads pull the day back out via UTC parts. This is
 * fully timezone-independent — the stored day never changes when viewed from a
 * different zone.
 *
 * Bookings (flights, check-ins) are genuine timed instants, NOT calendar days,
 * so they keep their real time and are placed on their local calendar day via
 * localDayKey().
 */

/** A datepicker Date (local midnight of the chosen day) → Timestamp at UTC
 *  midnight of that same calendar day. Use on every calendar-day write. */
export function toCalendarTimestamp(d: Date): Timestamp {
  return Timestamp.fromDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

/** A stored calendar Timestamp (UTC midnight) → a local-midnight Date of that
 *  same calendar day, suitable for datepickers and the schedule day grid. */
export function calendarDate(ts: Timestamp): Date {
  const d = ts.toDate();
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** 'YYYY-MM-DD' key from a Date's LOCAL parts (for grid days & timed bookings). */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' key from a Date's UTC parts (for stored calendar-day values). */
export function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Comparable integer for a calendar day (from LOCAL parts), e.g. 20260825. */
export function localDayNum(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Comparable integer for a calendar day (from UTC parts) — for stored
 *  calendar-day values compared against today. */
export function utcDayNum(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * Whole calendar days from today (local) to a stored calendar-day value (UTC).
 * Positive = in the future, 0 = today, negative = past. Compares day boundaries
 * only, so timezone offsets never cause an off-by-one.
 */
export function daysUntilCalendar(calDay: Date, now: Date = new Date()): number {
  const target = Date.UTC(calDay.getUTCFullYear(), calDay.getUTCMonth(), calDay.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
