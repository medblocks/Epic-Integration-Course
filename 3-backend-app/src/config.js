import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The project root is the folder that holds package.json, one level above src/.
// It is found from this file's location, so the app works from any directory.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Reads KEY=value lines from .env. Values already in process.env win.
function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    fail("No .env file found. Copy .env.example to .env and set EPIC_CLIENT_ID.");
  }
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    if (quoted) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

export const FHIR_BASE_URL = (process.env.EPIC_FHIR_BASE_URL ?? "").replace(/\/+$/, "");
export const CLIENT_ID = process.env.EPIC_CLIENT_ID ?? "";
export const PRIVATE_KEY_PATH = path.resolve(PROJECT_ROOT, process.env.PRIVATE_KEY_PATH ?? "./privatekey.pem");
export const REPORT_PATH = path.join(PROJECT_ROOT, "report.html");

if (!FHIR_BASE_URL) fail("EPIC_FHIR_BASE_URL is empty. Set it in .env.");
if (!CLIENT_ID) fail("EPIC_CLIENT_ID is empty. Set it in .env.");
if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  fail(`Private key not found at ${PRIVATE_KEY_PATH}. Set PRIVATE_KEY_PATH in .env.`);
}

// Epic sandbox test patients. Lookup mode reads these one at a time.
export const PATIENT_IDS = [
  "erXuFYUfucBZaryVksYEcMg3", // Camila Lopez
  "eq081-VQEgP8drUUqCWzHfw3", // Derrick Lin
  "eAB3mDIBBcyUKviyzrxsnAw3", // Desiree Powell
  "egqBHVfQlt4Bw3XGXoxVxHg3", // Elijah Davis
  "eIXesllypH3M9tAA5WdJftQ3", // Linda Ross
  "eh2xYHuzl9nkSFVvV3osUHg3", // Olivia Roberts
  "e0w0LEDCYtfckT6N.CkJKCw3", // Warren McGinnis
];

// The only group in the Epic sandbox. Bulk mode exports it.
export const BULK_GROUP_ID = "e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83";

// A reading is abnormal when it is below `low` or above `high`.
export const THRESHOLDS = {
  systolic:  { label: "Systolic blood pressure",  unit: "mmHg", low: 90, high: 140 },
  diastolic: { label: "Diastolic blood pressure", unit: "mmHg", low: 60, high: 90 },
  heartRate: { label: "Heart rate",               unit: "/min", low: 50, high: 100 },
  oxygen:    { label: "Oxygen saturation",        unit: "%",    low: 92 },
};

// Bulk polling, in seconds.
export const BULK_POLL_SECONDS = 10;
export const BULK_TIMEOUT_SECONDS = 1200;
