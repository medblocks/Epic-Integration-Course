import fs from "node:fs";
import { REPORT_PATH, THRESHOLDS } from "./config.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// "23 Nov 2026". A date-only value such as a birth date is not shifted by the time zone.
function formatDate(value) {
  if (!value) return "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${Number(dateOnly[3])} ${MONTHS[Number(dateOnly[2]) - 1]} ${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateTime(date) {
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDate(date.toISOString())}, ${time}`;
}

const byName = (a, b) => a.name.localeCompare(b.name);

// The three report rows. Blood pressure joins the systolic and diastolic readings.
function rows(patient) {
  const { systolic, diastolic, heartRate, oxygen } = patient.readings;
  const single = (label, reading) => ({
    label,
    value: reading ? `${reading.value} ${reading.unit}` : null,
    date: reading?.date ?? null,
    reasons: reading?.reason ? [reading.reason] : [],
  });
  const bloodPressure = {
    label: "Blood pressure",
    value: systolic || diastolic ? `${systolic?.value ?? "?"}/${diastolic?.value ?? "?"} mmHg` : null,
    date: systolic?.date ?? diastolic?.date ?? null,
    reasons: [systolic?.reason, diastolic?.reason].filter(Boolean),
  };
  return [bloodPressure, single("Heart rate", heartRate), single("Oxygen saturation", oxygen)];
}

function flaggedCard(patient) {
  const details = [patient.birthDate && `Born ${formatDate(patient.birthDate)}`, patient.gender].filter(Boolean).join(" · ");
  const body = rows(patient)
    .map((row) => {
      const abnormal = row.reasons.length > 0;
      return `<tr${abnormal ? ' class="abnormal"' : ""}>
          <th scope="row">${escapeHtml(row.label)}</th>
          <td>${row.value ? escapeHtml(row.value) : '<span class="muted">No reading</span>'}</td>
          <td>${escapeHtml(formatDate(row.date))}</td>
          <td>${abnormal ? escapeHtml(row.reasons.join(". ")) : ""}</td>
        </tr>`;
    })
    .join("\n");
  return `<article class="card">
      <h3>${escapeHtml(patient.name)}</h3>
      <p class="muted">${escapeHtml(details)}</p>
      <table>
        <thead><tr><th>Vital</th><th>Latest</th><th>Date</th><th>Why it is flagged</th></tr></thead>
        <tbody>
        ${body}
        </tbody>
      </table>
    </article>`;
}

function clearRow(patient) {
  const cells = rows(patient);
  const dates = cells.map((row) => row.date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
  const cell = (row) => `<td>${row.value ? escapeHtml(row.value) : '<span class="muted">No reading</span>'}</td>`;
  return `<tr><th scope="row">${escapeHtml(patient.name)}</th>${cells.map(cell).join("")}<td>${escapeHtml(formatDate(dates[0]))}</td></tr>`;
}

function thresholdText() {
  return Object.values(THRESHOLDS)
    .map(({ label, unit, low, high }) => {
      const parts = [low !== undefined && `below ${low}`, high !== undefined && `above ${high}`].filter(Boolean);
      return `${label} ${parts.join(" or ")} ${unit}`;
    })
    .join("; ");
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; background: #f4f6f8; color: #1c2430; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { margin: 0; font-size: 28px; }
  h2 { margin: 36px 0 12px; font-size: 18px; }
  h3 { margin: 0; font-size: 17px; }
  p { margin: 4px 0 0; }
  .muted { color: #667085; }
  .count { color: #667085; font-weight: 400; }
  .card { background: #fff; border: 1px solid #dde2e8; border-left: 4px solid #c0362c; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; break-inside: avoid; }
  .panel { background: #fff; border: 1px solid #dde2e8; border-radius: 8px; padding: 4px 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { padding: 8px 12px 8px 0; text-align: left; vertical-align: top; border-bottom: 1px solid #eceff3; }
  thead th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #667085; font-weight: 600; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody th { font-weight: 600; }
  tr.abnormal td, tr.abnormal th { color: #a12a22; font-weight: 600; }
  footer { margin-top: 32px; font-size: 13px; color: #667085; }
  @media print { body { background: #fff; padding: 0; } }
`;

export function writeReport(patients, { mode, startedAt }) {
  const checked = patients.filter((patient) => !patient.error);
  const flagged = checked.filter((patient) => patient.flagged).sort(byName);
  const clear = checked.filter((patient) => !patient.flagged).sort(byName);
  const notChecked = patients.filter((patient) => patient.error);
  const modeLabel = mode === "bulk" ? "Bulk mode" : "Lookup mode";

  const notCheckedSection = notChecked.length
    ? `<h2>Not checked <span class="count">(${notChecked.length})</span></h2>
    <div class="panel"><table>
      <thead><tr><th>Patient ID</th><th>Error</th></tr></thead>
      <tbody>
      ${notChecked.map((patient) => `<tr><th scope="row">${escapeHtml(patient.id)}</th><td>${escapeHtml(patient.error)}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VitalWatch report</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>VitalWatch</h1>
    <p class="muted">Run on ${escapeHtml(formatDateTime(startedAt))} · ${modeLabel} · ${checked.length} patients checked · ${flagged.length} flagged</p>

    <h2>Flagged <span class="count">(${flagged.length})</span></h2>
    ${flagged.length ? flagged.map(flaggedCard).join("\n") : '<p class="muted">No patients flagged.</p>'}

    <h2>All clear <span class="count">(${clear.length})</span></h2>
    ${
      clear.length
        ? `<div class="panel"><table>
      <thead><tr><th>Patient</th><th>Blood pressure</th><th>Heart rate</th><th>Oxygen saturation</th><th>Latest reading</th></tr></thead>
      <tbody>
      ${clear.map(clearRow).join("\n")}
      </tbody>
    </table></div>`
        : '<p class="muted">No patients are all clear.</p>'
    }

    ${notCheckedSection}

    <footer>Flagged when the latest reading is: ${escapeHtml(thresholdText())}.</footer>
  </main>
</body>
</html>
`;
  fs.writeFileSync(REPORT_PATH, html);
}
