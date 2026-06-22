import { Injectable } from '@angular/core';
import { Trip } from '../models/trip.model';
import { Booking } from '../models/booking.model';
import { ItineraryItem } from '../models/itinerary-item.model';

/**
 * Builds a downloadable iCalendar (.ics) file from a trip's bookings and
 * itinerary items. No external dependency — the VCALENDAR text is generated
 * by hand. Timed events use floating local time (`YYYYMMDDTHHMMSS`, no Z) to
 * sidestep timezone conversions; all-day events use `;VALUE=DATE`.
 */
@Injectable({ providedIn: 'root' })
export class IcsExportService {
  /** Returns valid VCALENDAR text for the trip, or an empty string if there's
   *  nothing dated to export. */
  buildIcs(trip: Trip, bookings: Booking[], itineraryItems: ItineraryItem[]): string {
    const events: string[] = [];

    for (const b of bookings ?? []) {
      const ev = this.bookingEvent(b);
      if (ev) events.push(ev);
    }
    for (const item of itineraryItems ?? []) {
      const ev = this.itineraryEvent(item);
      if (ev) events.push(ev);
    }

    if (events.length === 0) return '';

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SorTrek//Trip Export//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${this.escapeText(trip?.name ?? 'Trip')}`,
      ...events,
      'END:VCALENDAR',
    ];
    return lines.join('\r\n') + '\r\n';
  }

  /** Creates a text/calendar Blob and triggers a download via a temp anchor. */
  download(filename: string, icsText: string): void {
    const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.toLowerCase().endsWith('.ics') ? filename : `${filename}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Event builders ──────────────────────────────────────────────

  private bookingEvent(b: Booking): string | null {
    const start = b.checkIn?.toDate();
    if (!start) return null;
    const end = b.checkOut?.toDate();

    const summary = this.bookingSummary(b);
    const location = b.address ?? '';
    const descParts: string[] = [];
    if (b.provider) descParts.push(`Provider: ${b.provider}`);
    if (b.confirmationNumber) descParts.push(`Confirmation: ${b.confirmationNumber}`);
    if (b.flightNumber) descParts.push(`Flight: ${b.flightNumber}`);
    if (b.status) descParts.push(`Status: ${b.status}`);
    if (b.notes) descParts.push(b.notes);
    const description = descParts.join('\n');

    const uid = `${b.id ?? this.randomId()}@sortrek`;

    // Flights are timed (departure → arrival). Stays/rentals use timed events
    // when the timestamps carry a time of day, otherwise all-day.
    if (b.type === 'flight') {
      return this.event(uid, summary, location, description, start, end, true);
    }
    const timed = this.hasTime(start) || (end ? this.hasTime(end) : false);
    return this.event(uid, summary, location, description, start, end, timed);
  }

  private itineraryEvent(item: ItineraryItem): string | null {
    const baseDate = item.date?.toDate();
    if (!baseDate) return null;

    const summary = item.title || 'Activity';
    const location = item.location ?? '';
    const description = [item.description, item.notes].filter(Boolean).join('\n');
    const uid = `${item.id ?? this.randomId()}@sortrek`;

    // No startTime → all-day event on item.date.
    if (!item.startTime) {
      return this.event(uid, summary, location, description, baseDate, undefined, false);
    }

    const start = this.applyTime(baseDate, item.startTime);
    const end = item.endTime ? this.applyTime(baseDate, item.endTime) : undefined;
    return this.event(uid, summary, location, description, start, end, true);
  }

  // ── ICS plumbing ────────────────────────────────────────────────

  /** Assemble one VEVENT. When `timed` is false, start/end are emitted as
   *  all-day DATE values; when true they're floating local DATE-TIME values.
   *  A timed event with no end defaults to +1h; an all-day event with no end
   *  is a single day. */
  private event(
    uid: string,
    summary: string,
    location: string,
    description: string,
    start: Date,
    end: Date | undefined,
    timed: boolean,
  ): string {
    const out = [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${this.fmtUtc(new Date())}`,
    ];

    if (timed) {
      out.push(`DTSTART:${this.fmtLocal(start)}`);
      const e = end && end.getTime() > start.getTime()
        ? end
        : new Date(start.getTime() + 60 * 60 * 1000);
      out.push(`DTEND:${this.fmtLocal(e)}`);
    } else {
      out.push(`DTSTART;VALUE=DATE:${this.fmtDate(start)}`);
      // For all-day events DTEND is exclusive; default to the day after start,
      // or the day after the given end date for multi-day stays.
      const endDay = end && end.getTime() >= start.getTime() ? end : start;
      out.push(`DTEND;VALUE=DATE:${this.fmtDate(this.addDays(endDay, 1))}`);
    }

    out.push(`SUMMARY:${this.escapeText(summary)}`);
    if (location) out.push(`LOCATION:${this.escapeText(location)}`);
    if (description) out.push(`DESCRIPTION:${this.escapeText(description)}`);
    out.push('END:VEVENT');
    return out.join('\r\n');
  }

  private bookingSummary(b: Booking): string {
    switch (b.type) {
      case 'flight': {
        const route = b.departureAirport && b.arrivalAirport
          ? `${b.departureAirport}→${b.arrivalAirport}`
          : b.title;
        const num = b.flightNumber ? ` ${b.flightNumber}` : '';
        return `✈ ${route}${num}`.trim();
      }
      case 'hotel':
        return `🏨 Hotel — ${b.title}`;
      case 'airbnb':
        return `🏠 Stay — ${b.title}`;
      case 'car-rental':
        return `🚗 Car — ${b.title}`;
      default:
        return `📍 ${b.title}`;
    }
  }

  // ── Date/time helpers ───────────────────────────────────────────

  /** Floating local datetime: YYYYMMDDTHHMMSS (no trailing Z). */
  private fmtLocal(d: Date): string {
    return (
      this.pad(d.getFullYear(), 4) +
      this.pad(d.getMonth() + 1) +
      this.pad(d.getDate()) +
      'T' +
      this.pad(d.getHours()) +
      this.pad(d.getMinutes()) +
      this.pad(d.getSeconds())
    );
  }

  /** UTC datetime with Z, used for DTSTAMP. */
  private fmtUtc(d: Date): string {
    return (
      this.pad(d.getUTCFullYear(), 4) +
      this.pad(d.getUTCMonth() + 1) +
      this.pad(d.getUTCDate()) +
      'T' +
      this.pad(d.getUTCHours()) +
      this.pad(d.getUTCMinutes()) +
      this.pad(d.getUTCSeconds()) +
      'Z'
    );
  }

  /** Date-only value: YYYYMMDD (local). */
  private fmtDate(d: Date): string {
    return this.pad(d.getFullYear(), 4) + this.pad(d.getMonth() + 1) + this.pad(d.getDate());
  }

  /** Apply an "HH:mm" (or "HH:mm:ss") string onto the date portion of `base`. */
  private applyTime(base: Date, time: string): Date {
    const [h = '0', m = '0', s = '0'] = time.split(':');
    const d = new Date(base);
    d.setHours(Number(h) || 0, Number(m) || 0, Number(s) || 0, 0);
    return d;
  }

  private addDays(d: Date, days: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + days);
    return out;
  }

  private hasTime(d: Date): boolean {
    return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  }

  private pad(n: number, len = 2): string {
    return String(n).padStart(len, '0');
  }

  /** Escape per RFC 5545: backslash, semicolon, comma, and newlines. */
  private escapeText(text: string): string {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\n|\r/g, '\\n');
  }

  private randomId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
