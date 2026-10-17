// Section 7: turning FHIR resources into display values. Every accessor here
// tolerates missing fields and never puts undefined on screen.

import type {
  CodeableConcept,
  Encounter,
  MedicationRequest,
  Observation,
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

// A readable date, with the time when the value carried one.
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

// "HH:MM" in 24-hour local time, for the footer.
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
// Anything not listed is shown exactly as received. Display only: the unit
// sent back to Epic is always the raw unit. Values are never converted.
const UNIT_NAMES: Record<string, string> = {
  "mm[Hg]": "mmHg",
  Cel: "°C",
  "[degF]": "°F",
  "[lb_av]": "lb",
  "[oz_av]": "oz",
  "[in_i]": "in",
  "kg/m2": "kg/m²",
  "{beats}/min": "/min",
  "{breaths}/min": "/min",
};

export function displayUnit(unit: string | undefined): string {
  if (!unit) return "";
  return UNIT_NAMES[unit] ?? unit;
}

// The raw unit of a quantity: unit, else code. Empty when neither exists.
export function rawUnit(q: Quantity | undefined): string {
  return q?.unit ?? q?.code ?? "";
}

export function quantityUnit(q: Quantity | undefined): string {
  return displayUnit(rawUnit(q));
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

// ---------- Patient banner ----------

export interface PatientDisplay {
  name: string;
  // "12 Mar 1987 (39 y)", or "Not recorded".
  birthDateWithAge: string;
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
  let birthDateWithAge = NOT_RECORDED;
  if (birth) {
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const beforeBirthday =
      now.getMonth() < birth.getMonth() ||
      (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
    if (beforeBirthday) years--;
    const dateText = birth.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    birthDateWithAge = `${dateText} (${years} y)`;
  }

  const mrnEntry = (patient.identifier ?? []).find(
    (id) =>
      id.type?.coding?.some((c) => c.code === "MR") ||
      (id.type?.text ?? "").toUpperCase().includes("MRN"),
  );

  return {
    name,
    birthDateWithAge,
    gender: capitalise(patient.gender),
    mrn: mrnEntry?.value ?? null,
  };
}

// ---------- Encounter line ----------

export interface EncounterDisplay {
  className: string;
  status: string;
  start: string;
  // serviceProvider.display, else location[0].location.display, else null.
  place: string | null;
}

export function mapEncounter(encounter: Encounter): EncounterDisplay {
  return {
    className: encounter.class?.display ?? encounter.class?.code ?? "Visit",
    status: encounter.status ?? NOT_RECORDED,
    start: formatDate(encounter.period?.start, "start not recorded"),
    place: encounter.serviceProvider?.display ?? encounter.location?.[0]?.location?.display ?? null,
  };
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

// ---------- Observations ----------

export function observationDate(o: Observation): string | undefined {
  return o.effectiveDateTime ?? o.issued;
}

// A non-numeric value as text, for the table. Used when valueQuantity has no
// number. Component observations other than blood pressure list each part.
export function observationValueText(o: Observation): string {
  if (o.valueQuantity) return formatQuantity(o.valueQuantity);
  if (o.valueString) return o.valueString;
  if (o.valueCodeableConcept) return conceptText(o.valueCodeableConcept);
  if (o.component && o.component.length > 0) {
    return o.component
      .map((c) => {
        const value = c.valueQuantity
          ? formatQuantity(c.valueQuantity)
          : (c.valueString ?? (c.valueCodeableConcept ? conceptText(c.valueCodeableConcept) : "No value recorded"));
        return `${conceptText(c.code)}: ${value}`;
      })
      .join("; ");
  }
  return "No value recorded";
}
