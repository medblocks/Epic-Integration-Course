import { describeFailure, epicFetch } from "./auth.js";
import { FHIR_BASE_URL, PATIENT_IDS } from "./config.js";
import { patientName } from "./check.js";

const FHIR_JSON = { Accept: "application/fhir+json" };
const MAX_PAGES = 10;

async function getJson(url) {
  const res = await epicFetch(url, { headers: FHIR_JSON });
  if (!res.ok) throw new Error(await describeFailure(res));
  return res.json();
}

// Search for vital signs and follow the Bundle's "next" links.
async function fetchVitals(patientId) {
  const observations = [];
  let url = `${FHIR_BASE_URL}/Observation?patient=${encodeURIComponent(patientId)}&category=vital-signs`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const bundle = await getJson(url);
    for (const entry of bundle.entry ?? []) {
      // Epic can put an OperationOutcome next to the results. It is not a reading.
      if (entry.resource?.resourceType === "Observation") observations.push(entry.resource);
    }
    url = bundle.link?.find((link) => link.relation === "next")?.url ?? null;
  }
  return observations;
}

// Lookup mode: one patient at a time, in the configured order.
export async function fetchLookup() {
  console.log(`[lookup] ${PATIENT_IDS.length} patients configured`);
  const results = [];
  for (const id of PATIENT_IDS) {
    try {
      const patient = await getJson(`${FHIR_BASE_URL}/Patient/${encodeURIComponent(id)}`);
      const observations = await fetchVitals(id);
      console.log(`[lookup] ${patientName(patient)}: ${observations.length} vital-sign observations`);
      results.push({ patient, observations, error: null });
    } catch (err) {
      // One patient failing does not stop the run.
      console.log(`[lookup] ${id}: failed, ${err.message}`);
      results.push({ patient: { id }, observations: [], error: err.message });
    }
  }
  return results;
}
