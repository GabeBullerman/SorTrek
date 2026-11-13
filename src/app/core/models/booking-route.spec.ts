import {
  layoverCodes, stopCount, stopsLabel, hasRoute, routeWithLayovers,
  legFlightNumbers, layoverDuration, timelineNodes, RouteFormatting,
} from './booking-route';
import { Booking } from './booking.model';

function booking(partial: Partial<Booking>): Booking {
  return { type: 'flight', title: 't', tripId: 'trip1', status: 'confirmed', ...partial } as Booking;
}

const noTimes: RouteFormatting = {
  origin: { date: null, time: null, zone: null },
  destination: { date: null, time: null, zone: null },
};

describe('booking-route: stops', () => {
  it('reports a direct flight as nonstop', () => {
    const b = booking({ departureAirport: 'DEN', arrivalAirport: 'JFK' });
    expect(stopCount(b)).toBe(0);
    expect(stopsLabel(b)).toBe('Nonstop');
  });

  it('counts connections and renders them in travel order', () => {
    const b = booking({
      departureAirport: 'MAD', arrivalAirport: 'NRT',
      connections: [{ airport: 'BOS' }, { airport: 'HND' }],
    });
    expect(stopCount(b)).toBe(2);
    expect(stopsLabel(b)).toBe('2 stops');
    expect(routeWithLayovers(b)).toBe('MAD → BOS → HND → NRT');
  });

  it('falls back to the legacy layovers array', () => {
    const b = booking({ departureAirport: 'LHR', arrivalAirport: 'SYD', layovers: ['DXB'] });
    expect(layoverCodes(b)).toEqual(['DXB']);
    expect(routeWithLayovers(b)).toBe('LHR → DXB → SYD');
  });

  it('prefers connections over a stale layovers array', () => {
    const b = booking({
      departureAirport: 'A', arrivalAirport: 'B',
      layovers: ['OLD'], connections: [{ airport: 'NEW' }],
    });
    expect(layoverCodes(b)).toEqual(['NEW']);
  });

  it('ignores blank connection rows', () => {
    const b = booking({
      departureAirport: 'AAA', arrivalAirport: 'BBB',
      connections: [{ airport: '' }, { airport: 'CCC' }],
    });
    expect(stopCount(b)).toBe(1);
  });
});

describe('booking-route: hasRoute', () => {
  it('is false for a flight with no airports entered yet', () => {
    expect(hasRoute(booking({ flightNumber: 'DL1' }))).toBe(false);
  });

  it('is false for a booking that is not a flight', () => {
    expect(hasRoute(booking({ type: 'hotel', departureAirport: 'X' }))).toBe(false);
  });

  it('is true once either end is known', () => {
    expect(hasRoute(booking({ departureAirport: 'DEN' }))).toBe(true);
  });
});

describe('booking-route: layoverDuration', () => {
  it('measures an ordinary connection', () => {
    expect(layoverDuration('14:30', '16:45')).toBe('2h 15m');
  });

  it('drops the minutes on a whole hour, and the hours under one', () => {
    expect(layoverDuration('09:00', '10:00')).toBe('1h');
    expect(layoverDuration('09:00', '09:45')).toBe('45m');
  });

  it('treats a connection past midnight as an overnight, not a negative', () => {
    expect(layoverDuration('23:30', '06:15')).toBe('6h 45m');
  });

  it('accepts a single-digit hour', () => {
    expect(layoverDuration('9:05', '11:20')).toBe('2h 15m');
  });

  it('returns null rather than a wrong number for bad or missing input', () => {
    expect(layoverDuration('10:00', '10:00')).toBeNull();   // same minute
    expect(layoverDuration('25:00', '10:00')).toBeNull();   // impossible hour
    expect(layoverDuration('10:70', '12:00')).toBeNull();   // impossible minute
    expect(layoverDuration('10:00', undefined)).toBeNull();
    expect(layoverDuration(undefined, undefined)).toBeNull();
  });
});

describe('booking-route: timeline', () => {
  const connecting = booking({
    flightNumber: 'IB1', departureAirport: 'MAD', arrivalAirport: 'DEN',
    connections: [{ airport: 'BOS', flightNumber: 'DL2', arriveTime: '16:15', departTime: '20:03' }],
  });

  it('emits one node per airport, in order, correctly typed', () => {
    const nodes = timelineNodes(connecting, noTimes);
    expect(nodes.map(n => n.code)).toEqual(['MAD', 'BOS', 'DEN']);
    expect(nodes.map(n => n.kind)).toEqual(['origin', 'stop', 'dest']);
  });

  it('carries the time on the ground at a stop', () => {
    expect(timelineNodes(connecting, noTimes)[1].wait).toBe('3h 48m');
    expect(timelineNodes(connecting, noTimes)[1].time).toBe('16:15');
    expect(timelineNodes(connecting, noTimes)[1].until).toBe('20:03');
  });

  it('names the flight covering each leg', () => {
    expect(legFlightNumbers(connecting)).toEqual(['IB1', 'DL2']);
  });

  it('leaves a leg unnamed rather than guessing', () => {
    const b = booking({ flightNumber: 'A1', connections: [{ airport: 'BOS' }, { airport: 'HND' }] });
    expect(legFlightNumbers(b)).toEqual(['A1', null, null]);
  });

  it('places the supplied departure and arrival formatting on the end nodes', () => {
    const fmt: RouteFormatting = {
      origin: { date: 'Sep 4', time: '2:05 PM', zone: 'CEST' },
      destination: { date: 'Sep 4', time: '4:15 PM', zone: 'MDT' },
    };
    const nodes = timelineNodes(connecting, fmt);
    expect(nodes[0]).toMatchObject({ code: 'MAD', date: 'Sep 4', time: '2:05 PM', zone: 'CEST' });
    expect(nodes[2]).toMatchObject({ code: 'DEN', date: 'Sep 4', time: '4:15 PM', zone: 'MDT' });
  });

  it('degrades to bare codes for a legacy booking with no times', () => {
    const b = booking({ departureAirport: 'LHR', arrivalAirport: 'SYD', layovers: ['DXB'] });
    const nodes = timelineNodes(b, noTimes);
    expect(nodes.map(n => n.code)).toEqual(['LHR', 'SYD']);   // layovers-only has no connection rows
    expect(nodes.every(n => n.wait === null)).toBe(true);
  });

  it('shows ??? rather than an empty cell when an end is unset', () => {
    expect(timelineNodes(booking({ arrivalAirport: 'DEN' }), noTimes)[0].code).toBe('???');
  });
});
