import { describeFailure, epicFetch } from "./auth.js";
import { BULK_GROUP_ID, BULK_POLL_SECONDS, BULK_TIMEOUT_SECONDS, FHIR_BASE_URL } from "./config.js";

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function stop(label, res) {
  console.error(`[bulk]   ${label}: ${await describeFailure(res)}`);
  process.exit(1);
}

function retryAfter(res, fallback) {
  const seconds = Number(res.headers.get("retry-after"));
  return Math.max(5, Number.isFinite(seconds) && seconds > 0 ? seconds : fallback);
}

// Step 1: kickoff. Epic answers 202 and puts the status URL in Content-Location.
async function kickoff() {
  const url = `${FHIR_BASE_URL}/Group/${BULK_GROUP_ID}/$export?_type=Patient,Observation`;
  const res = await epicFetch(url, {
    headers: { Accept: "application/fhir+json", Prefer: "respond-async" },
  });
  const statusUrl = res.headers.get("content-location");
  if (res.status !== 202 || !statusUrl) await stop("Kickoff failed", res);
  console.log(`[bulk]   Kickoff: ${res.status} Accepted`);
  return statusUrl;
}

// Step 2: poll the status URL until it answers 200 with the list of files.
async function waitForExport(statusUrl) {
  const deadline = Date.now() + BULK_TIMEOUT_SECONDS * 1000;
  while (Date.now() < deadline) {
    const res = await epicFetch(statusUrl, { headers: { Accept: "application/json" } });
    if (res.status === 200) {
      const manifest = await res.json();
      console.log(`[bulk]   Status: 200, export ready: ${manifest.output?.length ?? 0} files`);
      return manifest;
    }
    if (res.status === 202) {
      const wait = retryAfter(res, BULK_POLL_SECONDS);
      const progress = res.headers.get("x-progress") ?? "in progress";
      console.log(`[bulk]   Status: 202, ${progress}. Checking again in ${wait}s`);
      await sleep(wait);
    } else if (res.status === 429) {
      const wait = retryAfter(res, 30);
      console.log(`[bulk]   Status: 429, Epic is throttling. Checking again in ${wait}s`);
      await sleep(wait);
    } else {
      await stop("Status check failed", res);
    }
  }
  console.error(`[bulk]   The export did not finish within ${BULK_TIMEOUT_SECONDS} seconds.`);
  process.exit(1);
}

// Step 3: download the NDJSON files. One JSON resource per line.
async function download(manifest) {
  const files = (manifest.output ?? []).filter((file) => file.type === "Patient" || file.type === "Observation");
  const resources = [];
  for (const [index, file] of files.entries()) {
    console.log(`[bulk]   Downloading ${file.type} (${index + 1} of ${files.length})`);
    const res = await epicFetch(file.url, { headers: { Accept: "application/fhir+ndjson" } });
    if (!res.ok) await stop(`Download of ${file.type} failed`, res);
    for (const line of (await res.text()).split("\n")) {
      if (line.trim()) resources.push(JSON.parse(line));
    }
  }
  return resources;
}

// Step 4: tell Epic the export is no longer needed. A failure here is not an error.
async function cleanUp(statusUrl) {
  const res = await epicFetch(statusUrl, { method: "DELETE" });
  console.log(res.ok ? "[bulk]   Export deleted" : `[bulk]   Export not deleted (${res.status})`);
}

const isVitalSign = (observation) =>
  (observation.category ?? []).some((category) => (category.coding ?? []).some((coding) => coding.code === "vital-signs"));

// Bulk mode: one export for the whole group, shaped like the lookup result.
export async function fetchBulk() {
  const statusUrl = await kickoff();
  const manifest = await waitForExport(statusUrl);
  const resources = await download(manifest);

  // Group the vital-sign observations by patient.
  const patients = resources.filter((resource) => resource.resourceType === "Patient");
  const byPatient = new Map(patients.map((patient) => [patient.id, []]));
  let vitalCount = 0;
  for (const resource of resources) {
    if (resource.resourceType !== "Observation" || !isVitalSign(resource)) continue;
    const patientId = resource.subject?.reference?.split("Patient/").pop();
    if (!byPatient.has(patientId)) continue;
    byPatient.get(patientId).push(resource);
    vitalCount++;
  }
  console.log(`[bulk]   Downloads complete: ${patients.length} patients, ${vitalCount} vital-sign observations`);
  await cleanUp(statusUrl);
  return patients.map((patient) => ({ patient, observations: byPatient.get(patient.id), error: null }));
}
