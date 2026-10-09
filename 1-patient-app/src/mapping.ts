// Section 7: turning FHIR resources into display values. Every accessor here
// tolerates missing fields and never returns undefined for display.

import type {
  CodeableConcept,
  Condition,
  MedicationRequest,
  Observation,
  ObservationComponent,
  Patient,
  Quantity,
} from "./types";

export const NOT_RECORDED = "Not recorded";

// General rule: .text, else coding[0].display, else coding[0].code "(code)".
export function conceptText(concept: CodeableConcept | undefined): string {
  if (!concept) return NOT_RECORDED;
  if (concept.text) return concept.text;
  const first = concept.coding?.[0];
  if (first?.display) return first.display;
  if (first?.code) return `${first.code} (code)`;
  return NOT_RECORDED;
}

// Parses a FHIR date or dateTime. Date-only values ("1987-09-12") are parsed
// as local dates so the day does not shift with the timezone.
export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const yearOnly = /^(\d{4})(-(\d{2}))?$/.exec(value);
  if (yearOnly) {
    return new Date(Number(yearOnly[1]), yearOnly[3] ? Number(yearOnly[3]) - 1 : 0, 1);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string | undefined, fallback = NOT_RECORDED): string {
  const date = parseDate(value);
  if (!date) return fallback;
  const hasTime = !!value && value.includes("T");
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatClockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

// Sort most recent first. Missing dates sort last. Stable.
export function sortByDateDesc<T>(items: T[], getDate: (item: T) => string | undefined): T[] {
  return items
    .map((item, index) => ({ item, index, time: parseDate(getDate(item))?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return b.time - a.time || a.index - b.index;
    })
    .map((x) => x.item);
}

export function formatNumber(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return NOT_RECORDED;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// UCUM codes that Epic sends as the unit, mapped to how people write them.
// Anything not listed is shown exactly as received. Values are never converted.
const UNIT_NAMES: Record<string, string> = {
  "mm[Hg]": "mmHg",
  Cel: "°C",
  "[degF]": "°F",
  "[lb_av]": "lb",
  "[oz_av]": "oz",
  "[in_i]": "in",
  "kg/m2": "kg/m²",
  "/min": "/min",
  "{beats}/min": "/min",
  "{breaths}/min": "/min",
  "%": "%",
};

export function displayUnit(unit: string | undefined): string {
  if (!unit) return "";
  return UNIT_NAMES[unit] ?? unit;
}

export function quantityUnit(q: Quantity | undefined): string {
  return displayUnit(q?.unit ?? q?.code);
}

export function formatQuantity(q: Quantity | undefined): string {
  if (!q || typeof q.value !== "number") return NOT_RECORDED;
  const unit = quantityUnit(q);
  return unit ? `${formatNumber(q.value)} ${unit}` : formatNumber(q.value);
}

export function capitalise(value: string | undefined): string {
  if (!value) return NOT_RECORDED;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ---------- Patient ----------

export interface PatientDisplay {
  name: string;
  birthDate: string;
  age: string;
  gender: string;
  mrn: string | null;
}

export function mapPatient(patient: Patient): PatientDisplay {
  const names = patient.name ?? [];
  const chosen = names.find((n) => n.use === "official") ?? names[0];
  let name = NOT_RECORDED;
  if (chosen) {
    if (chosen.text) {
      name = chosen.text;
    } else {
      const parts = [...(chosen.given ?? []), chosen.family ?? ""].filter(Boolean);
      name = parts.length ? parts.join(" ") : NOT_RECORDED;
    }
  }

  const birth = parseDate(patient.birthDate);
  let age = NOT_RECORDED;
  if (birth) {
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const beforeBirthday =
      now.getMonth() < birth.getMonth() ||
      (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
    if (beforeBirthday) years--;
    age = `${years} years`;
  }

  const mrnEntry = (patient.identifier ?? []).find(
    (id) =>
      id.type?.coding?.some((c) => c.code === "MR") ||
      (id.type?.text ?? "").toUpperCase().includes("MRN"),
  );

  return {
    name,
    birthDate: formatDate(patient.birthDate),
    age,
    gender: capitalise(patient.gender),
    mrn: mrnEntry?.value ?? null,
  };
}

// ---------- Conditions ----------

export interface ConditionDisplay {
  key: string;
  name: string;
  status: string | null;
  date: string;
}

export function mapConditions(conditions: Condition[]): ConditionDisplay[] {
  const kept = conditions.filter(
    (c) => c.verificationStatus?.coding?.[0]?.code !== "entered-in-error",
  );
  const sorted = sortByDateDesc(kept, (c) => c.onsetDateTime ?? c.recordedDate);
  return sorted.map((c, i) => ({
    key: c.id ?? `condition-${i}`,
    name: conceptText(c.code),
    status: c.clinicalStatus?.coding?.[0]?.code ?? null,
    date: formatDate(c.onsetDateTime ?? c.recordedDate, "Date not recorded"),
  }));
}

// ---------- Medications ----------

export interface MedicationDisplay {
  key: string;
  name: string;
  instructions: string;
  status: string | null;
  date: string;
  prescriber: string | null;
}

export function mapMedications(requests: MedicationRequest[]): MedicationDisplay[] {
  const sorted = sortByDateDesc(requests, (m) => m.authoredOn);
  // Active first, then everything else, each group keeping date order.
  const ordered = [
    ...sorted.filter((m) => m.status === "active"),
    ...sorted.filter((m) => m.status !== "active"),
  ];
  return ordered.map((m, i) => {
    let name: string;
    if (m.medicationCodeableConcept) {
      name = conceptText(m.medicationCodeableConcept);
    } else if (m.medicationReference) {
      // Do not fetch the referenced Medication resource.
      name = m.medicationReference.display ?? "Medication (details not available)";
    } else {
      name = NOT_RECORDED;
    }
    return {
      key: m.id ?? `medication-${i}`,
      name,
      instructions: m.dosageInstruction?.[0]?.text ?? "No instructions on file",
      status: m.status ?? null,
      date: formatDate(m.authoredOn),
      prescriber: m.requester?.display ?? null,
    };
  });
}

// ---------- Observations (shared) ----------

function componentValue(c: ObservationComponent): string {
  if (c.valueQuantity) return formatQuantity(c.valueQuantity);
  if (c.valueString) return c.valueString;
  if (c.valueCodeableConcept) return conceptText(c.valueCodeableConcept);
  return "No value recorded";
}

// Value lines for an observation, in the spec's order of checks.
export function observationValueLines(o: Observation): string[] {
  if (o.valueQuantity) return [formatQuantity(o.valueQuantity)];
  if (o.valueString) return [o.valueString];
  if (o.valueCodeableConcept) return [conceptText(o.valueCodeableConcept)];
  if (o.component && o.component.length > 0) {
    return o.component.map((c) => `${conceptText(c.code)}: ${componentValue(c)}`);
  }
  return ["No value recorded"];
}

export function observationDate(o: Observation): string | undefined {
  return o.effectiveDateTime ?? o.issued;
}

// ---------- Lab results ----------

export interface LabDisplay {
  key: string;
  name: string;
  valueLines: string[];
  referenceRange: string | null;
  flag: string | null;
  date: string;
  earlierCount: number;
}

function referenceRangeText(o: Observation): string | null {
  const range = o.referenceRange?.[0];
  if (!range) return null;
  if (range.text) return range.text;
  const low = range.low?.value;
  const high = range.high?.value;
  const unit = range.low?.unit ?? range.high?.unit ?? range.low?.code ?? range.high?.code ?? "";
  if (typeof low === "number" && typeof high === "number") {
    return `${formatNumber(low)} to ${formatNumber(high)}${unit ? ` ${unit}` : ""}`;
  }
  if (typeof low === "number") return `above ${formatNumber(low)}${unit ? ` ${unit}` : ""}`;
  if (typeof high === "number") return `below ${formatNumber(high)}${unit ? ` ${unit}` : ""}`;
  return null;
}

export function mapLabs(observations: Observation[]): LabDisplay[] {
  const sorted = sortByDateDesc(observations, observationDate);
  // Group by test name: keep the most recent, count the earlier ones.
  const seen = new Map<string, LabDisplay>();
  for (const [i, o] of sorted.entries()) {
    const name = conceptText(o.code);
    const existing = seen.get(name);
    if (existing) {
      existing.earlierCount++;
      continue;
    }
    seen.set(name, {
      key: o.id ?? `lab-${i}`,
      name,
      valueLines: observationValueLines(o),
      referenceRange: referenceRangeText(o),
      flag: o.interpretation?.[0]?.coding?.[0]?.code ?? null,
      date: formatDate(observationDate(o)),
      earlierCount: 0,
    });
  }
  return [...seen.values()];
}
