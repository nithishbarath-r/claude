using intelliops as db from '../db/schema';

// The OData service the cockpit reads. Entities are read-only: every write goes through
// an action, so every write lands in the ledger.
@requires: 'any' // prototype: no authentication — BTP identity (XSUAA) in production
service CockpitService {
  @readonly entity Consignments as projection on db.Consignments;
  @readonly entity Legs         as projection on db.Legs excluding { simActualMins };
  @readonly entity Readings     as projection on db.Readings;
  @readonly entity Facilities   as projection on db.Facilities;
  @readonly entity Sessions     as projection on db.Sessions;
  @readonly entity Products     as projection on db.Products;
  @readonly entity Serves       as projection on db.Serves;
  @readonly entity Signals      as projection on db.Signals;
  @readonly entity Escalations  as projection on db.Escalations;
  @readonly entity Options      as projection on db.Options;
  @readonly entity Ledger       as projection on db.Ledger;
  @readonly entity DwellModels  as projection on db.DwellModels;
  @readonly entity RouteMemory  as projection on db.RouteMemory;

  // cockpit read models (JSON)
  function overview()                        returns LargeString;
  function detail(escalation : UUID)         returns LargeString;
  function injectTargets(kind : String)      returns LargeString;

  // the human gate
  action approve(option : UUID, actor : String, note : String)       returns LargeString;
  action dismiss(escalation : UUID, actor : String, reason : String) returns LargeString;

  // demo control panel
  action inject(kind : String, ref : String) returns LargeString;
  action clock(op : String, value : Decimal) returns LargeString;
  action setGate(on : Boolean)               returns LargeString;
  action reset()                             returns LargeString;
}
