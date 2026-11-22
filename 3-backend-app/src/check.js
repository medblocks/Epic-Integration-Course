import { THRESHOLDS } from "./config.js";

const LOINC = "http://loinc.org";
const BP_PANEL = "85354-9";
const CODES = {
  systolic: ["8480-6"],
  diastolic: ["8462-4"],
  heartRate: ["8867-4"],
  oxygen: ["2708-6", "59408-5"],
};

const hasCode = (concept, codes) =>
  (concept?.coding ?? []).some((coding) => coding.system === LOINC && codes.includes(coding.code));

const readingDate = (observation) =>
  observation.effectiveDateTime ?? observation.effectivePeriod?.start ?? observation.issued ?? null;

// Pulls the number for one vital out of an observation, or returns null.
function valueFor(vital, observation) {
  let quantity = null;
  if (hasCode(observation.code, CODES[vital])) {
    quantity = observation.valueQuantity;
  } else if ((vital === "systolic" || vital === "diastolic") && hasCode(observation.code, [BP_PANEL])) {
    quantity = (observation.component ?? []).find((part) => hasCode(part.code, CODES[vital]))?.valueQuantity;
  }
  return typeof quantity?.value === "number" ? quantity.value : null;
}

// The latest reading of one vital, judged against its threshold.
function latestReading(vital, observations) {
  let latest = null;
  for (const observation of observations) {
    if (observation.status === "entered-in-error" || observation.status === "cancelled") continue;
    const value = valueFor(vital, observation);
    const date = readingDate(observation);
    if (value === null || !date) continue;
    if (!latest || new Date(date) > new Date(latest.date)) latest = { value, date };
  }
  if (!latest) return null;

  const { label, unit, low, high } = THRESHOLDS[vital];
  let reason = null;
  if (low !== undefined && latest.value < low) reason = `${label} ${latest.value} ${unit} is below ${low}`;
  if (high !== undefined && latest.value > high) reason = `${label} ${latest.value} ${unit} is above ${high}`;
  return { ...latest, unit, abnormal: reason !== null, reason };
}

// Given names then family name, from the official name when there is one.
export function patientName(patient) {
  const name = patient.name?.find((entry) => entry.use === "official") ?? patient.name?.[0];
  if (!name) return "Unknown patient";
  const full = [...(name.given ?? []), name.family].filter(Boolean).join(" ");
  return full || name.text || "Unknown patient";
}

export function checkPatients(results) {
  return results.map(({ patient, observations, error }) => {
    const readings = {};
    for (const vital of Object.keys(CODES)) readings[vital] = latestReading(vital, observations);
    return {
      id: patient.id,
      name: patientName(patient),
      birthDate: patient.birthDate ?? null,
      gender: patient.gender ?? null,
      error,
      readings,
      flagged: Object.values(readings).some((reading) => reading?.abnormal),
    };
  });
}
