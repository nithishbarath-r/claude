namespace intelliops;

using { cuid, managed } from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Master data — stand-ins for the S/4HANA extract (seeded by sim/generate.js)
// ---------------------------------------------------------------------------

entity Facilities : cuid {
  code        : String;           // 'DS-MDU'
  name        : String;
  kind        : String;           // STATE_STORE | DISTRICT_STORE | PHC | HOSPITAL
  district    : String;
  bufferDoses : Integer;
  powerRisk   : String;           // LOW | MEDIUM | HIGH
  coldRoom    : Boolean;          // can take a diverted consignment
}

entity Sessions : cuid {
  facility         : Association to Facilities;
  sessionDate      : Timestamp;   // session start
  antigen          : String;
  dosesRequired    : Integer;
  expectedChildren : Integer;
}

entity Products : cuid {
  code               : String;    // 'PENTA'
  name               : String;
  minTempC           : Decimal;   // 2
  maxTempC           : Decimal;   // 8
  freezeSensitive    : Boolean;
  budgetMinutesAbove : Integer;   // cumulative weighted minutes above max before potency loss
  budgetMinutesBelow : Integer;   // usually very small — freezing is near-instant
}

// ---------------------------------------------------------------------------
// The watched chain
// ---------------------------------------------------------------------------

entity Consignments : cuid, managed {
  ref         : String;           // 'CNS-1042'
  product     : Association to Products;
  batch       : String;
  doses       : Integer;
  origin      : Association to Facilities;
  destination : Association to Facilities;
  route       : String;           // 'CHN-MDU'
  carrier     : String;
  vehicle     : String;
  departedAt  : Timestamp;
  promisedAt  : Timestamp;        // when the destination needs it
  status      : String;           // IN_TRANSIT | DELIVERED | QUARANTINED
  disposition : String;           // null | RELEASED | QUARANTINED | DESTROYED
  legs        : Composition of many Legs     on legs.consignment = $self;
  readings    : Composition of many Readings on readings.consignment = $self;
  serves      : Composition of many Serves   on serves.consignment = $self;
}

entity Legs : cuid {
  consignment   : Association to Consignments;
  seq           : Integer;
  kind          : String;         // DISPATCH | LONGHAUL | LASTMILE | HANDOVER
  fromFac       : Association to Facilities;
  toFac         : Association to Facilities;
  km            : Integer;        // 0 for dock legs
  enteredAt     : Timestamp;
  exitedAt      : Timestamp;      // null while in progress
  plannedMins   : Integer;
  movedMins     : Integer;        // telemetry: minutes the vehicle was actually moving in this leg
  simActualMins : Integer;        // SIMULATOR GROUND TRUTH — agents never read this
}

entity Readings : cuid {
  consignment : Association to Consignments;
  at          : Timestamp;
  tempC       : Decimal;
  moving      : Boolean;
  km          : Decimal;          // position along the current leg (GPS)
  legSeq      : Integer;
}

// which sessions depend on this consignment — the link nobody has today
entity Serves : cuid {
  consignment : Association to Consignments;
  session     : Association to Sessions;
  doses       : Integer;
}

// ERP business event stand-in: a batch placed on quality hold
entity BatchHolds : cuid {
  batch    : String;
  facility : Association to Facilities;
  at       : Timestamp;
  reason   : String;
}

// ---------------------------------------------------------------------------
// Agent output
// ---------------------------------------------------------------------------

entity Signals : cuid {
  consignment : Association to Consignments;
  at          : Timestamp;
  kind        : String;           // EXCURSION | DWELL | SILENT_STALL | QUALITY_HOLD
  detail      : String;
  severity    : Decimal;
  mode        : String;           // PLANNED | LEARNED (dwell model provenance)
  outcome     : String;           // LOGGED | ESCALATED | ATTACHED
  reason      : String;           // why it was only logged
}

entity Escalations : cuid, managed {
  consignment     : Association to Consignments;
  kind            : String;       // HEAT | FREEZE | DWELL | SILENT_STALL | QUALITY_HOLD
  raisedAt        : Timestamp;
  breachAt        : Timestamp;
  pointOfNoReturn : Timestamp;
  probability     : Decimal;
  exposure        : Decimal;      // ranking score
  dosesAtRisk     : Integer;
  childrenAtRisk  : Integer;
  facilitiesCount : Integer;
  sessionsCount   : Integer;
  reasoning       : String(1000); // the narrated sentence
  state           : String;       // OPEN | ACTIONED | CLOSED | DISMISSED
  forecast        : LargeString;  // JSON: budget, projection series, provenance
  impact          : LargeString;  // JSON: facilities and sessions downstream
  evidence        : LargeString;  // JSON evidence pack, written on each decision
  options         : Composition of many Options on options.escalation = $self;
}

entity Options : cuid {
  escalation  : Association to Escalations;
  kind        : String;           // DIVERT | REICE | EXPEDITE | REALLOCATE | REPROMISE | QUARANTINE | RELEASE | DESTROY
  label       : String;
  detail      : String(1000);
  projectedAt : Timestamp;
  actBy       : Timestamp;
  costInr     : Integer;
  confidence  : Decimal;
  needsQA     : Boolean;
  verdict     : String;           // compliance gate: REQUIRE_MEERA | REQUIRE_QA | ADVISORY_ONLY
  gateReason  : String;
  recommended : Boolean;
  rank        : Integer;
  provenance  : LargeString;      // JSON
  chosen      : Boolean;
  decidedBy   : String;
  decidedAt   : Timestamp;
}

// append-only audit trail — never update a row
entity Ledger : cuid {
  at          : Timestamp;
  agent       : String;
  stage       : String;
  consignment : Association to Consignments;
  payload     : LargeString;      // JSON
  actor       : String;           // 'agent' | 'meera' | 'qa'
}

// ---------------------------------------------------------------------------
// Learned models — written by the simulator's history pass
// ---------------------------------------------------------------------------

entity DwellModels : cuid {
  route      : String;
  legKind    : String;
  medianMins : Integer;
  p95Mins    : Integer;
  sigmaMins  : Integer;
  samples    : Integer;
  mode       : String;            // PLANNED | LEARNED
}

// route memory: fingerprints of past disruptions and what worked
entity RouteMemory : cuid {
  route      : String;
  legKind    : String;
  at         : Timestamp;
  kind       : String;            // HEAT | FREEZE | DWELL | SILENT_STALL
  peakTempC  : Decimal;
  minutesOut : Integer;
  hourOfDay  : Integer;
  action     : String;            // DIVERT | REICE | EXPEDITE | REALLOCATE | REPROMISE | NONE
  outcome    : String;            // SAVED | LOST
  summary    : String;
}

// simulator-only state: causes injected into the world. Agents never read this.
entity SimFaults : cuid {
  consignment : Association to Consignments;
  kind        : String;           // HEAT | FREEZE | STALL
  startAt     : Timestamp;
  endAt       : Timestamp;
  params      : LargeString;      // JSON
}
