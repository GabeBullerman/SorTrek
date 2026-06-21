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
  /** For flights this is the departure datetime; for stays, the check-in datetime. Includes time of day. */
  checkIn?: Timestamp;
  /** For flights this is the arrival datetime; for stays, the check-out datetime. Includes time of day. */
  checkOut?: Timestamp;
  status: BookingStatus;
  notes?: string;
  passengerIds?: string[];
  paidById?: string | null;

  // ── Flight-specific ────────────────────────────────────────────
  /** e.g. "DL123" or "BA 256" — IATA flight number, used for status lookups. */
  flightNumber?: string;
  /** Per-passenger ticket / e-ticket numbers, keyed by TripParticipant id. */
  ticketNumbers?: Record<string, string>;
  /** Departure airport IATA code, e.g. "JFK". */
  departureAirport?: string;
  /** Arrival airport IATA code, e.g. "LAX". */
  arrivalAirport?: string;
  /** Layover/connection airport IATA codes, in order, between departure and arrival. */
  layovers?: string[];
  /** Last live status pulled from the flight-tracking API. */
  flightStatus?: FlightStatus;

  createdAt: Timestamp;
}
