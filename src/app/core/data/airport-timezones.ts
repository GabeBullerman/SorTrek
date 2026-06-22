/**
 * IATA airport code → IANA timezone.
 *
 * Covers the busiest ~140 airports worldwide (enough for the vast majority of
 * itineraries). Unknown codes simply return null and the UI falls back to no
 * timezone label. To extend, add `CODE: 'Region/City'` rows — keep alphabetical
 * within each region block for readability.
 */
export const AIRPORT_TIMEZONES: Readonly<Record<string, string>> = {
  // ── North America ──────────────────────────────────────────────
  ATL: 'America/New_York', BOS: 'America/New_York', BWI: 'America/New_York',
  CLT: 'America/New_York', DCA: 'America/New_York', DTW: 'America/New_York',
  EWR: 'America/New_York', FLL: 'America/New_York', IAD: 'America/New_York',
  JFK: 'America/New_York', LGA: 'America/New_York', MCO: 'America/New_York',
  MIA: 'America/New_York', PHL: 'America/New_York', PIT: 'America/New_York',
  RDU: 'America/New_York', TPA: 'America/New_York',
  ORD: 'America/Chicago', MDW: 'America/Chicago', DFW: 'America/Chicago',
  IAH: 'America/Chicago', HOU: 'America/Chicago', MSP: 'America/Chicago',
  STL: 'America/Chicago', MCI: 'America/Chicago', AUS: 'America/Chicago',
  SAT: 'America/Chicago', MSY: 'America/Chicago', BNA: 'America/Chicago',
  DEN: 'America/Denver', SLC: 'America/Denver', ABQ: 'America/Denver',
  PHX: 'America/Phoenix',
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SAN: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles', OAK: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles', LAS: 'America/Los_Angeles', SMF: 'America/Los_Angeles',
  ANC: 'America/Anchorage', HNL: 'Pacific/Honolulu',
  YYZ: 'America/Toronto', YUL: 'America/Toronto', YOW: 'America/Toronto',
  YVR: 'America/Vancouver', YYC: 'America/Edmonton', YEG: 'America/Edmonton',
  MEX: 'America/Mexico_City', CUN: 'America/Cancun', GDL: 'America/Mexico_City',

  // ── South America ──────────────────────────────────────────────
  GRU: 'America/Sao_Paulo', GIG: 'America/Sao_Paulo', BSB: 'America/Sao_Paulo',
  EZE: 'America/Argentina/Buenos_Aires', SCL: 'America/Santiago',
  BOG: 'America/Bogota', LIM: 'America/Lima', PTY: 'America/Panama',

  // ── Europe ─────────────────────────────────────────────────────
  LHR: 'Europe/London', LGW: 'Europe/London', STN: 'Europe/London',
  MAN: 'Europe/London', EDI: 'Europe/London', DUB: 'Europe/Dublin',
  CDG: 'Europe/Paris', ORY: 'Europe/Paris', NCE: 'Europe/Paris',
  AMS: 'Europe/Amsterdam', BRU: 'Europe/Brussels',
  FRA: 'Europe/Berlin', MUC: 'Europe/Berlin', BER: 'Europe/Berlin',
  DUS: 'Europe/Berlin', HAM: 'Europe/Berlin',
  ZRH: 'Europe/Zurich', GVA: 'Europe/Zurich', VIE: 'Europe/Vienna',
  MAD: 'Europe/Madrid', BCN: 'Europe/Madrid', AGP: 'Europe/Madrid',
  PMI: 'Europe/Madrid', LIS: 'Europe/Lisbon', OPO: 'Europe/Lisbon',
  FCO: 'Europe/Rome', MXP: 'Europe/Rome', VCE: 'Europe/Rome', NAP: 'Europe/Rome',
  ATH: 'Europe/Athens', CPH: 'Europe/Copenhagen', ARN: 'Europe/Stockholm',
  OSL: 'Europe/Oslo', HEL: 'Europe/Helsinki', WAW: 'Europe/Warsaw',
  PRG: 'Europe/Prague', BUD: 'Europe/Budapest', IST: 'Europe/Istanbul',
  SVO: 'Europe/Moscow', DME: 'Europe/Moscow', KEF: 'Atlantic/Reykjavik',

  // ── Middle East & Africa ───────────────────────────────────────
  DXB: 'Asia/Dubai', AUH: 'Asia/Dubai', DOH: 'Asia/Qatar',
  RUH: 'Asia/Riyadh', JED: 'Asia/Riyadh', TLV: 'Asia/Jerusalem',
  CAI: 'Africa/Cairo', JNB: 'Africa/Johannesburg', CPT: 'Africa/Johannesburg',
  NBO: 'Africa/Nairobi', CMN: 'Africa/Casablanca', ADD: 'Africa/Addis_Ababa',

  // ── Asia ───────────────────────────────────────────────────────
  HKG: 'Asia/Hong_Kong', PEK: 'Asia/Shanghai', PKX: 'Asia/Shanghai',
  PVG: 'Asia/Shanghai', SHA: 'Asia/Shanghai', CAN: 'Asia/Shanghai',
  SZX: 'Asia/Shanghai', NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo',
  KIX: 'Asia/Tokyo', ICN: 'Asia/Seoul', GMP: 'Asia/Seoul',
  TPE: 'Asia/Taipei', BKK: 'Asia/Bangkok', DMK: 'Asia/Bangkok',
  SIN: 'Asia/Singapore', KUL: 'Asia/Kuala_Lumpur', CGK: 'Asia/Jakarta',
  MNL: 'Asia/Manila', DEL: 'Asia/Kolkata', BOM: 'Asia/Kolkata',
  BLR: 'Asia/Kolkata', MAA: 'Asia/Kolkata', HYD: 'Asia/Kolkata',
  CCU: 'Asia/Kolkata',

  // ── Oceania ────────────────────────────────────────────────────
  SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne', BNE: 'Australia/Brisbane',
  PER: 'Australia/Perth', ADL: 'Australia/Adelaide', AKL: 'Pacific/Auckland',
  CHC: 'Pacific/Auckland', WLG: 'Pacific/Auckland',
};
