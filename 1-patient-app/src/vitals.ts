// Vitals: groups vital-sign Observations by type and prepares each type for a
// tile, a graph, and a table. Section 7 of the spec.

import type { CodeableConcept, Observation } from "./types";
import {
  conceptText,
  formatDate,
  formatNumber,
  formatQuantity,
  quantityUnit,
  observationDate,
  observationValueLines,
  parseDate,
  sortByDateDesc,
} from "./mapping";

const LOINC = "http://loinc.org";

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

const BLOOD_PRESSURE_ID = "blood-pressure";
const SYSTOLIC = "8480-6";
const DIASTOLIC = "8462-4";

export interface VitalReading {
  key: string;
  // Milliseconds since epoch, or null when the observation has no usable date.
  time: number | null;
  dateText: string;
  // Full value with unit, for tiles and tooltips. Example: "120/80 mmHg".
  display: string;
  // One table cell per series. Blood pressure has two, every other vital has one.
  cells: string[];
  // One number per series, or null where there is no numeric value.
  values: (number | null)[];
  unit: string;
  // True when this reading is drawn on the graph.
  plotted: boolean;
}

export interface VitalKind {
  id: string;
  label: string;
  // LOINC codes this type is matched on. Empty for "other" vitals.
  codes: string[];
  known: boolean;
  seriesNames: string[];
  // Unit of the graph: the unit of the most recent numeric reading.
  unit: string;
  // Most recent first. This is the table.
  readings: VitalReading[];
  // Oldest first. This is the graph.
  points: VitalReading[];
  // Readings that are in the table but not on the graph.
  notPlotted: number;
}

function loincCodes(concept: CodeableConcept | undefined): string[] {
  return (concept?.coding ?? [])
    .filter((c) => c.system === LOINC && c.code)
    .map((c) => c.code as string);
}

function numeric(value: number | undefined): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function bloodPressureReading(o: Observation, index: number): VitalReading {
  const component = (code: string) =>
    (o.component ?? []).find((c) => loincCodes(c.code).includes(code))?.valueQuantity;
  const systolic = component(SYSTOLIC);
  const diastolic = component(DIASTOLIC);
  const s = numeric(systolic?.value);
  const d = numeric(diastolic?.value);
  const unit = quantityUnit(systolic) || quantityUnit(diastolic) || "mmHg";
  const date = observationDate(o);
  const hasValue = s !== null || d !== null;
  return {
    key: o.id ?? `bp-${index}`,
    time: parseDate(date)?.getTime() ?? null,
    dateText: formatDate(date),
    display: hasValue
      ? `${s !== null ? formatNumber(s) : "?"}/${d !== null ? formatNumber(d) : "?"} ${unit}`
      : "No value recorded",
    cells: [
      s !== null ? formatNumber(s) : "Not recorded",
      d !== null ? formatNumber(d) : "Not recorded",
    ],
    values: [s, d],
    unit,
    plotted: false,
  };
}

function simpleReading(o: Observation, index: number, idPrefix: string): VitalReading {
  const value = numeric(o.valueQuantity?.value);
  const date = observationDate(o);
  const display =
    value !== null ? formatQuantity(o.valueQuantity) : observationValueLines(o).join("; ");
  return {
    key: o.id ?? `${idPrefix}-${index}`,
    time: parseDate(date)?.getTime() ?? null,
    dateText: formatDate(date),
    display,
    cells: [display],
    values: [value],
    unit: value !== null ? quantityUnit(o.valueQuantity) : "",
    plotted: false,
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
    buildKind(
      def.id,
      def.label,
      def.codes,
      true,
      sorted.filter((o) => matches(o, def.codes)),
    ),
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

// ---------- Date range filtering (Vitals page) ----------

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

// Earliest and latest dated reading across all types, for the custom range defaults.
export function dateBounds(kinds: VitalKind[]): { min: number; max: number } | null {
  const times = kinds
    .flatMap((k) => k.readings.map((r) => r.time))
    .filter((t): t is number => t !== null);
  if (times.length === 0) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
}

// Lowest and highest plotted value per series, for the stats row.
export function seriesRanges(kind: VitalKind): { name: string; min: number; max: number }[] {
  return kind.seriesNames
    .map((name, i) => {
      const values = kind.points.map((p) => p.values[i]).filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      return { name, min: Math.min(...values), max: Math.max(...values) };
    })
    .filter((r): r is { name: string; min: number; max: number } => r !== null);
}
