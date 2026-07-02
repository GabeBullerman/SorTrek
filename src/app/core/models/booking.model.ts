import { Timestamp } from '@angular/fire/firestore';

export type BookingType = 'flight' | 'hotel' | 'airbnb' | 'car-rental' | 'other';
export type BookingStatus = 'confirmed' | 'pending' | 'cancelled' | 'suggested';

/**
 * Live flight status fetched from an airline/flight-tracking API
 * (see api/flight-status.js). All times are ISO 8601 strings as
 * returned by the provider; null when the provider has no value.
 */
export interface FlightStatus {
  flightStatus: string | null;        // scheduled | active | landed | cancelled | incident | diverted | unknown
  airline: string | null;
  flightNumber: string | null;
  departureAirport: string | null;
  arrivalAirport: string | null;
  scheduledDeparture: string | null;
  estimatedDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  departureTerminal: string | null;
  departureGate: string | null;
  arrivalTerminal: string | null;
  arrivalGate: string | null;
  departureDelayMinutes: number | null;
  arrivalDelayMinutes: number | null;
  updatedAt: Timestamp;               // when we last fetched this status
}

export interface BookingAttachment {
  name: string;
  url: string;
  storagePath: string;
  fileType?: string;
  fileSize?: number;
}

export interface Booking {
  id?: string;
  tripId: string;
  type: BookingType;
  title: string;
  provider?: string;
  confirmationNumber?: string;
  bookingUrl?: string;
  cost?: number;
  currency?: string;
  /** Reward points spent on this booking (e.g. 200000). Tracked alongside —
   *  not instead of — the cash cost, so spending stays realistic. */
  pointsCost?: number;
  /** Where the points came from, e.g. "American Airlines AAdvantage". */
  pointsProgram?: string;
  /** For flights this is the departure datetime; for stays, the check-in datetime. Includes time of day. */
  checkIn?: Timestamp;
  /** For flights this is the arrival datetime; for stays, the check-out datetime. Includes time of day. */
  checkOut?: Timestamp;
  status: BookingStatus;
  notes?: string;
  passengerIds?: string[];
  paidById?: string | null;
  /** Street address / place name for accommodations & other located bookings,
   *  geocoded to show a marker on the trip map. */
  address?: string;

  // ── Flight-specific ────────────────────────────────────────────
  /** e.g. "DL123" or "BA 256" — IATA flight number, used for status lookups. */
  flightNumber?: string;
  /** Per-passenger ticket / e-ticket numbers, keyed by TripParticipant id (legacy). */
  ticketNumbers?: Record<string, string>;
  /** Free-form per-person ticket numbers — one row per traveller on the flight. */
  passengerTickets?: { name: string; ticket: string }[];
  /** Departure airport IATA code, e.g. "JFK". */
  departureAirport?: string;
  /** Arrival airport IATA code, e.g. "LAX". */
  arrivalAirport?: string;
  /** Layover/connection airport IATA codes, in order (derived from connections). */
  layovers?: string[];
  /** Connecting flights through each layover: the airport you connect at plus
   *  the onward flight's number and departure time. */
  connections?: { airport: string; flightNumber?: string; departTime?: string }[];
  /** Last live status pulled from the flight-tracking API. */
  flightStatus?: FlightStatus;

  /** Uploaded files (boarding passes, hotel confirmations, etc.). */
  attachments?: BookingAttachment[];

  /** Set true by the flight-reminder cron once a check-in push has been sent,
   *  so the daily job doesn't re-notify for the same flight. */
  checkInReminderSent?: boolean;

  createdAt: Timestamp;
}
