// Vitals: groups vital-sign Observations by type, prepares each type for a
// tile, a graph and a table, and builds the write-back body. Section 7.

import type { CodeableConcept, Coding, Observation, Quantity, Session } from "./types";
import {
  conceptText,
  formatDate,
  formatNumber,
  observationDate,
  observationValueText,
  parseDate,
  quantityUnit,
  rawUnit,
  sortByDateDesc,
} from "./mapping";

const LOINC = "http://loinc.org";
// Epic's own identifier for a flowsheet row, present on readings Epic returns.
const FLOWSHEET_SYSTEM = "http://open.epic.com/FHIR/StructureDefinition/observation-flowsheet-id";

export const VITAL_DEFINITIONS: { id: string; label: string; codes: string[] }[] = [
  { id: "blood-pressure", label: "Blood pressure", codes: ["85354-9"] },
  { id: "heart-rate", label: "Heart rate", codes: ["8867-4"] },
  { id: "body-temperature", label: "Body temperature", codes: ["8310-5"] },
  { id: "respiratory-rate", label: "Respiratory rate", codes: ["9279-1"] },
  { id: "oxygen-saturation", label: "Oxygen saturation", codes: ["2708-6", "59408-5"] },
  { id: "height", label: "Height", codes: ["8302-2"] },
  { id: "weight", label: "Weight", codes: ["29463-7"] },
  { id: "bmi", label: "BMI", codes: ["39156-5"] },
];

export const BLOOD_PRESSURE_ID = "blood-pressure";
const SYSTOLIC = "8480-6";
const DIASTOLIC = "8462-4";

export interface VitalReading {
  key: string;
  // Milliseconds since epoch, or null when the observation has no usable date.
  time: number | null;
  dateText: string;
  // Full value with unit, for tiles and tooltips. Example: "120/80 mmHg".
  display: string;
  // One table cell per series. Blood pressure has two, every other vital one.
  cells: string[];
  // One number per series, or null where there is no numeric value.
  values: (number | null)[];
  // Display unit of this reading.
  unit: string;
  // True when this reading is drawn on the graph.
  plotted: boolean;
  // The Observation exactly as Epic returned it. The write-back copies from it.
  resource: Observation;
}

export interface VitalKind {
  id: string;
  label: string;
  // LOINC codes this type is matched on. Empty for "other" vitals.
  codes: string[];
  known: boolean;
  seriesNames: string[];
  // Display unit of the graph: the unit of the most recent numeric reading.
  unit: string;
  // Most recent first. This is the table.
  readings: VitalReading[];
  // Oldest first. This is the graph.
  points: VitalReading[];
  // Readings that are in the table but not on the graph.
  notPlotted: number;
}

export function loincCodes(concept: CodeableConcept | undefined): string[] {
  return (concept?.coding ?? [])
    .filter((c) => c.system === LOINC && c.code)
    .map((c) => c.code as string);
}

function numeric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bpComponent(o: Observation, code: string): Quantity | undefined {
  return (o.component ?? []).find((c) => loincCodes(c.code).includes(code))?.valueQuantity;
}

function bloodPressureReading(o: Observation, index: number): VitalReading {
  const systolic = bpComponent(o, SYSTOLIC);
  const diastolic = bpComponent(o, DIASTOLIC);
  const s = numeric(systolic?.value);
  const d = numeric(diastolic?.value);
  const unit = quantityUnit(systolic) || quantityUnit(diastolic);
  const date = observationDate(o);
  const hasValue = s !== null || d !== null;
  return {
    key: o.id ?? `bp-${index}`,
    time: parseDate(date)?.getTime() ?? null,
    dateText: formatDate(date),
    display: hasValue
      ? `${s !== null ? formatNumber(s) : "?"}/${d !== null ? formatNumber(d) : "?"}${unit ? ` ${unit}` : ""}`
      : "No value recorded",
    cells: [
      s !== null ? formatNumber(s) : "Not recorded",
      d !== null ? formatNumber(d) : "Not recorded",
    ],
    values: [s, d],
    unit,
    plotted: false,
    resource: o,
  };
}

function simpleReading(o: Observation, index: number, idPrefix: string): VitalReading {
  const value = numeric(o.valueQuantity?.value);
  const date = observationDate(o);
  const display = observationValueText(o);
  return {
    key: o.id ?? `${idPrefix}-${index}`,
    time: parseDate(date)?.getTime() ?? null,
    dateText: formatDate(date),
    display,
    cells: [display],
    values: [value],
    unit: value !== null ? quantityUnit(o.valueQuantity) : "",
    plotted: false,
    resource: o,
  };
}

function buildKind(
  id: string,
  label: string,
  codes: string[],
  known: boolean,
  observations: Observation[],
): VitalKind {
  const isBp = id === BLOOD_PRESSURE_ID;
  // observations arrive most recent first.
  const readings = observations.map((o, i) =>
    isBp ? bloodPressureReading(o, i) : simpleReading(o, i, id),
  );

  // The graph uses one unit: the unit of the most recent numeric reading.
  // Readings in a different unit stay in the table but are not drawn, because
  // mixing kg and lb on one axis would draw a false trend.
  const firstNumeric = readings.find((r) => r.values.some((v) => v !== null));
  const unit = firstNumeric?.unit ?? "";
  for (const reading of readings) {
    reading.plotted =
      reading.time !== null && reading.unit === unit && reading.values.some((v) => v !== null);
  }

  const points = readings
    .filter((r) => r.plotted)
    .slice()
    .sort((a, b) => (a.time as number) - (b.time as number));

  return {
    id,
    label,
    codes,
    known,
    seriesNames: isBp ? ["Systolic", "Diastolic"] : [label],
    unit,
    readings,
    points,
    notPlotted: readings.length - points.length,
  };
}

// Returns the eight known vitals in fixed order (even when empty), followed by
// every other vital-sign observation grouped by its name.
export function mapVitalKinds(observations: Observation[]): VitalKind[] {
  const sorted = sortByDateDesc(observations, observationDate);
  const knownCodes = new Set(VITAL_DEFINITIONS.flatMap((def) => def.codes));
  const matches = (o: Observation, codes: string[]) =>
    loincCodes(o.code).some((code) => codes.includes(code));

  const known = VITAL_DEFINITIONS.map((def) =>
    buildKind(def.id, def.label, def.codes, true, sorted.filter((o) => matches(o, def.codes))),
  );

  const groups = new Map<string, Observation[]>();
  for (const o of sorted) {
    if (loincCodes(o.code).some((code) => knownCodes.has(code))) continue;
    const name = conceptText(o.code);
    const group = groups.get(name);
    if (group) group.push(o);
    else groups.set(name, [o]);
  }
  const others = [...groups.entries()].map(([name, group], i) =>
    buildKind(`other-${i}`, name, [], false, group),
  );

  return [...known, ...others];
}

// ---------- Date range filtering ----------

// Milliseconds since epoch, inclusive. null means no bound on that side.
export interface DateRange {
  from: number | null;
  to: number | null;
}

function inRange(time: number | null, range: DateRange): boolean {
  if (range.from === null && range.to === null) return true;
  // A reading with no date cannot be placed in a bounded range.
  if (time === null) return false;
  if (range.from !== null && time < range.from) return false;
  if (range.to !== null && time > range.to) return false;
  return true;
}

// Returns a copy of the type with only the readings inside the range. The
// graph points are the plotted readings in that range, oldest first.
export function filterKindByDate(kind: VitalKind, range: DateRange): VitalKind {
  const readings = kind.readings.filter((r) => inRange(r.time, range));
  const points = kind.points.filter((r) => inRange(r.time, range));
  return { ...kind, readings, points, notPlotted: readings.length - points.length };
}

// Earliest and latest dated reading of one type, for the custom range defaults.
export function dateBounds(kind: VitalKind): { min: number; max: number } | null {
  const times = kind.readings.map((r) => r.time).filter((t): t is number => t !== null);
  if (times.length === 0) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
}

// ---------- Add a reading ----------

// Picks the one coding that is sent back to Epic as the Observation's code.
//
// The spec said to copy the whole code, every coding included. The sandbox
// rejects that: a reading Epic returns carries several codings (an Epic
// flowsheet-row ID, an Epic internal code, the vital's LOINC code and the
// generic "Vital signs" LOINC 8716-3), and when two of them map to different
// flowsheet rows the create fails with error 59102 "Multiple Flowsheet rows
// found by given codes". So exactly one coding is sent, chosen from the
// reading Epic returned (still never built from a code table), in this order:
//   1. Epic's flowsheet-row coding, the most precise identifier at that site;
//   2. the LOINC coding the type was matched on;
//   3. any LOINC coding;
//   4. the first coding.
// The concept's text is kept. The FHIR panel shows what was actually sent.
export function writeCode(code: CodeableConcept | undefined, typeCodes: string[]): CodeableConcept | undefined {
  const codings = code?.coding ?? [];
  const chosen =
    codings.find((c) => c.system === FLOWSHEET_SYSTEM && c.code) ??
    codings.find((c) => c.system === LOINC && c.code && typeCodes.includes(c.code)) ??
    codings.find((c) => c.system === LOINC && c.code) ??
    codings[0];
  if (!code || !chosen) return code;
  return { ...(code.text ? { text: code.text } : {}), coding: [chosen] };
}

// "LOINC 8867-4" or "Epic flowsheet row t0nle…", for the "Will be filed as" line.
export function describeCoding(coding: Coding | undefined): string {
  if (!coding?.code) return "no code";
  if (coding.system === LOINC) return `LOINC ${coding.code}`;
  if (coding.system === FLOWSHEET_SYSTEM) return `Epic flowsheet row ${coding.code}`;
  return `${coding.system ?? "code"} ${coding.code}`;
}

// One input in the form: its label and the unit copied from the source
// reading. `rawUnit` is what is sent to Epic; `unit` is what is shown.
export interface WriteField {
  label: string;
  unit: string;
  rawUnit: string;
}

export type WriteTemplate =
  | {
      ok: true;
      // The most recent reading of the type. Its code is copied whole.
      source: Observation;
      fields: WriteField[];
      // Text for "Will be filed as <name> (<coding>)": the name and the one
      // coding that will be sent.
      codeText: string;
      codingText: string;
    }
  | { ok: false; reason: string };

// A quantity can be copied when it has a numeric value and a unit or code.
function copyable(q: Quantity | undefined): q is Quantity {
  return !!q && numeric(q.value) !== null && rawUnit(q) !== "";
}

// Decides whether the form can be enabled for a type, and with which fields.
// Everything except the value is copied from the most recent reading, exactly
// as Epic returned it, because Epic accepts only codes mapped to a flowsheet
// row at that site, and a code Epic itself sent is the surest to be accepted.
export function writeTemplate(kind: VitalKind, session: Session): WriteTemplate {
  const latest = kind.readings[0];
  if (!latest) {
    return { ok: false, reason: "No existing reading to copy the code and unit from" };
  }
  if (session.encounter === null) {
    return {
      ok: false,
      reason: "No encounter in this launch. Epic needs an open visit to file a vital.",
    };
  }
  const source = latest.resource;
  const noValue = { ok: false as const, reason: "The latest reading has no numeric value and unit to copy." };

  if (kind.id === BLOOD_PRESSURE_ID) {
    const systolic = bpComponent(source, SYSTOLIC);
    const diastolic = bpComponent(source, DIASTOLIC);
    if (!copyable(systolic) || !copyable(diastolic)) return noValue;
    return {
      ok: true,
      source,
      fields: [
        { label: "Systolic", unit: quantityUnit(systolic), rawUnit: rawUnit(systolic) },
        { label: "Diastolic", unit: quantityUnit(diastolic), rawUnit: rawUnit(diastolic) },
      ],
      codeText: conceptText(source.code),
      codingText: describeCoding(writeCode(source.code, kind.codes)?.coding?.[0]),
    };
  }

  if (!copyable(source.valueQuantity)) return noValue;
  return {
    ok: true,
    source,
    fields: [
      {
        label: "Value",
        unit: quantityUnit(source.valueQuantity),
        rawUnit: rawUnit(source.valueQuantity),
      },
    ],
    codeText: conceptText(source.code),
    codingText: describeCoding(writeCode(source.code, kind.codes)?.coding?.[0]),
  };
}

// valueQuantity for the new reading: the typed number plus the source
// quantity's unit, system and code, with the spec's fallbacks.
function quantityFrom(q: Quantity, value: number): Record<string, unknown> {
  return {
    value,
    unit: q.unit ?? q.code,
    system: q.system ?? "http://unitsofmeasure.org",
    code: q.code ?? q.unit,
  };
}

// The Observation body sent to Epic. Only the fields listed in the spec:
// nothing else is copied from the source reading (no id, meta, identifier,
// issued or performer). The code is narrowed to one coding; see writeCode.
export function buildObservationBody(
  kind: VitalKind,
  source: Observation,
  values: number[],
  session: Session,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    resourceType: "Observation",
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "vital-signs",
            display: "Vital Signs",
          },
        ],
      },
    ],
    code: writeCode(source.code, kind.codes),
    subject: { reference: `Patient/${session.patient}` },
    encounter: { reference: `Encounter/${session.encounter ?? ""}` },
    effectiveDateTime: new Date().toISOString(),
  };

  if (kind.id === BLOOD_PRESSURE_ID) {
    const parts = [SYSTOLIC, DIASTOLIC].map((code, i) => {
      const component = (source.component ?? []).find((c) => loincCodes(c.code).includes(code));
      return {
        code: writeCode(component?.code, [code]),
        valueQuantity: quantityFrom(component?.valueQuantity ?? {}, values[i]),
      };
    });
    body.component = parts;
  } else {
    body.valueQuantity = quantityFrom(source.valueQuantity ?? {}, values[0]);
  }
  return body;
}
