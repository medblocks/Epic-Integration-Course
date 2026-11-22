import path from "node:path";
import { REPORT_PATH } from "./config.js";
import { getAccessToken } from "./auth.js";
import { fetchLookup } from "./fetch-lookup.js";
import { fetchBulk } from "./fetch-bulk.js";
import { checkPatients } from "./check.js";
import { writeReport } from "./report.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--bulk")) {
  console.error("Usage: npm start [-- --bulk]");
  process.exit(1);
}

// `npm start --bulk` does not pass the flag on. npm keeps it and sets npm_config_bulk instead.
const bulk = args.includes("--bulk") || process.env.npm_config_bulk === "true";
const mode = bulk ? "bulk" : "lookup";
const startedAt = new Date();

console.log(`VitalWatch, ${mode} mode`);

await getAccessToken();
const results = bulk ? await fetchBulk() : await fetchLookup();

// Never write a report when nothing could be read.
if (results.every((result) => result.error)) {
  console.error("No patient data could be read. No report was written.");
  process.exit(1);
}

const patients = checkPatients(results);
const checked = patients.filter((patient) => !patient.error);
const flagged = checked.filter((patient) => patient.flagged).length;
const notChecked = patients.length - checked.length;

console.log(
  `[check]  ${flagged} flagged, ${checked.length - flagged} all clear${notChecked ? `, ${notChecked} not checked` : ""}`,
);

writeReport(patients, { mode, startedAt });
console.log(`[report] Written to ${path.basename(REPORT_PATH)}`);
