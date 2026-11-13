import { Booking } from './booking.model';

/**
 * Pure derivation of a flight's route from a booking.
 *
 * Kept out of the component so it can be tested without Angular's DI, and so
 * the same logic can be reused anywhere a route is shown (the cards, the
 * schedule, the public itinerary) rather than reimplemented per surface.
 */

/** Connection airports in order. `connections` is the richer source; older
 *  bookings only carry the plain `layovers` codes. */
export function layoverCodes(booking: Booking): string[] {
  if (booking.connections?.length) {
    return booking.connections.map(c => c.airport).filter((a): a is string => !!a);
  }
  return booking.layovers ?? [];
}

export function stopCount(booking: Booking): number {
  return layoverCodes(booking).length;
}

/** "Nonstop" / "1 stop" / "2 stops" — the thing people scan for. */
export function stopsLabel(booking: Booking): string {
  const n = stopCount(booking);
  return n === 0 ? 'Nonstop' : `${n} stop${n === 1 ? '' : 's'}`;
}

/** True once there's enough of a route to say anything about stops. */
export function hasRoute(booking: Booking): boolean {
  return booking.type === 'flight'
    && !!(booking.departureAirport || booking.arrivalAirport || stopCount(booking));
}

/** Full route string, e.g. "MAD → LIS → JFK". Used for screen readers. */
export function routeWithLayovers(booking: Booking): string {
  return [
    booking.departureAirport ?? '?',
    ...layoverCodes(booking),
    booking.arrivalAirport ?? '?',
  ].join(' → ');
}

/** Flight number for each leg: the booking's own, then each onward flight. */
export function legFlightNumbers(booking: Booking): (string | null)[] {
  return [
    booking.flightNumber ?? null,
    ...(booking.connections ?? []).filter(c => !!c.airport).map(c => c.flightNumber ?? null),
  ];
}

/**
 * Time on the ground between landing and the onward departure, as "2h 15m".
 *
 * Both are local "HH:mm" at the layover airport, so a connection running past
 * midnight comes out negative — that's an overnight, so add a day. Returns null
 * unless both times are present and parse.
 */
export function layoverDuration(arrive?: string, depart?: string): string | null {
  const toMinutes = (t?: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const from = toMinutes(arrive);
  const to = toMinutes(depart);
  if (from === null || to === null) return null;

  let mins = to - from;
  if (mins < 0) mins += 24 * 60;      // overnight connection
  if (mins === 0) return null;         // same minute is a data slip, not a wait

  const h = Math.floor(mins / 60), m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export interface TimelineNode {
  code: string;
  kind: 'origin' | 'stop' | 'dest';
  date: string | null;
  time: string | null;
  until: string | null;
  zone: string | null;
  wait: string | null;
}

/** Supplies the timezone-aware formatting the nodes need, so this module stays
 *  free of Angular services and is testable with a stub. */
export interface RouteFormatting {
  origin: { date: string | null; time: string | null; zone: string | null };
  destination: { date: string | null; time: string | null; zone: string | null };
}

/**
 * The flight as a timeline: one node per airport, each carrying its own times.
 * The card used to show only the first departure and the last arrival, so the
 * middle of a connecting trip had no times at all.
 */
export function timelineNodes(booking: Booking, fmt: RouteFormatting): TimelineNode[] {
  return [
    {
      code: booking.departureAirport || '???',
      kind: 'origin',
      date: fmt.origin.date, time: fmt.origin.time, until: null,
      zone: fmt.origin.zone, wait: null,
    },
    ...(booking.connections ?? []).filter(c => !!c.airport).map(c => ({
      code: c.airport,
      kind: 'stop' as const,
      date: null,
      time: c.arriveTime || null,
      until: c.departTime || null,
      zone: null,
      wait: layoverDuration(c.arriveTime, c.departTime),
    })),
    {
      code: booking.arrivalAirport || '???',
      kind: 'dest',
      date: fmt.destination.date, time: fmt.destination.time, until: null,
      zone: fmt.destination.zone, wait: null,
    },
  ];
}
