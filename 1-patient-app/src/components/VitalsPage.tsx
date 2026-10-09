// The full-page vitals view, opened from "View more" on the Vitals section.
// It is a full-screen <dialog> inside Screen C, not a fourth screen, so the
// app keeps its single route and its three screens.

import { useEffect, useMemo, useRef, useState } from "react";
import type { RequestLog } from "../types";
import { formatNumber } from "../mapping";
import {
  dateBounds,
  filterKindByDate,
  seriesRanges,
  type DateRange,
  type VitalKind,
} from "../vitals";
import { LineChart } from "./LineChart";
import { VitalsDebug } from "./VitalsSection";

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)"];
const TABLE_LIMIT = 25;
const DAY = 24 * 60 * 60 * 1000;

type PresetId = "all" | "30d" | "90d" | "1y" | "5y" | "custom";
type View = "graph" | "table";

const PRESETS: { id: PresetId; label: string; days: number | null }[] = [
  { id: "all", label: "All time", days: null },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "1y", label: "Last year", days: 365 },
  { id: "5y", label: "Last 5 years", days: 5 * 365 },
  { id: "custom", label: "Custom", days: null },
];

// "2024-03-15" from a local date, for <input type="date">.
function toInputDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Start of the local day for a "yyyy-mm-dd" input value.
function startOfDay(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function endOfDay(value: string): number | null {
  const start = startOfDay(value);
  return start === null ? null : start + DAY - 1;
}

function describeRange(range: DateRange): string {
  if (range.from === null && range.to === null) return "all time";
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  if (range.from !== null && range.to !== null) return `${day(range.from)} to ${day(range.to)}`;
  if (range.from !== null) return `since ${day(range.from)}`;
  return `up to ${day(range.to as number)}`;
}

function VitalBlock({ kind, view }: { kind: VitalKind; view: View }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? kind.readings : kind.readings.slice(0, TABLE_LIMIT);
  const latest = kind.readings[0];
  const ranges = seriesRanges(kind);
  const twoSeries = kind.seriesNames.length > 1;

  return (
    <section className="vital-block" aria-label={kind.label}>
      <div className="vital-detail-head">
        <h3>{kind.label}</h3>
        <span className="muted">
          {kind.readings.length} {kind.readings.length === 1 ? "reading" : "readings"}
          {kind.unit ? `, measured in ${kind.unit}` : ""}
        </span>
      </div>

      {kind.readings.length === 0 ? (
        <p className="muted chart-empty">No readings in this date range.</p>
      ) : (
        <>
          <dl className="stats-row">
            <div>
              <dt>Latest</dt>
              <dd>{latest.display}</dd>
              <dd className="muted">{latest.dateText}</dd>
            </div>
            {ranges.map((r) => (
              <div key={r.name}>
                <dt>{twoSeries ? `${r.name} range` : "Range"}</dt>
                <dd>
                  {formatNumber(r.min)} to {formatNumber(r.max)}
                  {kind.unit ? ` ${kind.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>

          {view === "graph" ? (
            <>
              {kind.points.length >= 2 ? (
                <LineChart
                  title={kind.label}
                  unit={kind.unit}
                  series={kind.seriesNames.map((name, i) => ({ name, color: SERIES_COLORS[i] }))}
                  points={kind.points.map((p) => ({
                    key: p.key,
                    time: p.time as number,
                    dateText: p.dateText,
                    values: p.values,
                  }))}
                />
              ) : (
                <p className="muted chart-empty">
                  {kind.points.length === 1
                    ? "Only one reading can be plotted. A graph needs at least two. Switch to the table view to see it."
                    : "These readings have no numeric value, so there is no graph. Switch to the table view to see them."}
                </p>
              )}
              {kind.points.length >= 2 && kind.notPlotted > 0 && (
                <p className="muted chart-note">
                  {kind.notPlotted} {kind.notPlotted === 1 ? "reading is" : "readings are"} in the
                  table but not on the graph, because{" "}
                  {kind.notPlotted === 1 ? "it has" : "they have"} no date, no numeric value, or a
                  different unit.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="table-scroll">
                <table className="vital-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {twoSeries ? (
                        kind.seriesNames.map((name) => (
                          <th key={name} className="num">
                            {name}
                            {kind.unit ? ` (${kind.unit})` : ""}
                          </th>
                        ))
                      ) : (
                        <th className="num">Value</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((reading) => (
                      <tr key={reading.key}>
                        <td>{reading.dateText}</td>
                        {reading.cells.map((cell, i) => (
                          <td key={i} className="num">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {kind.readings.length > TABLE_LIMIT && (
                <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show fewer" : `Show all (${kind.readings.length})`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function VitalsPage({
  kinds,
  patientName,
  requests,
  observationCount,
  onClose,
}: {
  kinds: VitalKind[];
  patientName: string;
  requests: RequestLog[];
  observationCount: number | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bounds = useMemo(() => dateBounds(kinds), [kinds]);

  const [preset, setPreset] = useState<PresetId>("all");
  const [customFrom, setCustomFrom] = useState(bounds ? toInputDate(bounds.min) : "");
  const [customTo, setCustomTo] = useState(bounds ? toInputDate(bounds.max) : "");
  const [view, setView] = useState<View>("graph");
  const [typeId, setTypeId] = useState<string>("all");

  // Open as a modal on mount. Escape fires the dialog's close event, which
  // calls onClose, so one path handles the Close button and the Escape key.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      return { from: startOfDay(customFrom), to: endOfDay(customTo) };
    }
    const days = PRESETS.find((p) => p.id === preset)?.days ?? null;
    if (days === null) return { from: null, to: null };
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime() - (days - 1) * DAY, to: null };
  }, [preset, customFrom, customTo]);

  const filtered = useMemo(() => kinds.map((k) => filterKindByDate(k, range)), [kinds, range]);
  const withData = kinds.filter((k) => k.readings.length > 0);
  // "All types" shows every type that has readings at all, so a type that is
  // empty only because of the date range still appears and says so.
  const idsWithData = new Set(withData.map((k) => k.id));
  const visible =
    typeId === "all"
      ? filtered.filter((k) => idsWithData.has(k.id))
      : filtered.filter((k) => k.id === typeId);
  const totalInRange = filtered.reduce((n, k) => n + k.readings.length, 0);
  const undated = kinds.reduce((n, k) => n + k.readings.filter((r) => r.time === null).length, 0);

  const typeButton = (id: string, label: string, count: number | null, disabled = false) => (
    <button
      key={id}
      type="button"
      className={typeId === id ? "type-item selected" : "type-item"}
      aria-pressed={typeId === id}
      disabled={disabled}
      title={disabled ? "Not recorded" : undefined}
      onClick={() => setTypeId(id)}
    >
      <span>{label}</span>
      <span className="type-count">{count === null ? "none" : count}</span>
    </button>
  );

  return (
    <dialog ref={dialogRef} className="vitals-dialog" onClose={onClose} aria-label="Vitals">
      <div className="vitals-page">
        <header className="vitals-head">
          <div>
            <div className="eyebrow">Showing records for</div>
            <h2>Vitals for {patientName}</h2>
          </div>
          <button type="button" className="secondary" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </header>

        <div className="vitals-layout">
          <aside className="vitals-side" aria-label="Vital type">
            <div className="side-title">Vital type</div>
            <div className="type-list">
              {typeButton("all", "All types", totalInRange)}
              {kinds.map((kind) => {
                const hasAny = kind.readings.length > 0;
                const count = filtered.find((f) => f.id === kind.id)?.readings.length ?? 0;
                return typeButton(kind.id, kind.label, hasAny ? count : null, !hasAny);
              })}
            </div>
          </aside>

          <div className="vitals-main">
            <div className="toolbar">
              <div className="toolbar-group">
                <span className="toolbar-label">Date range</span>
                <div className="segmented" role="group" aria-label="Date range">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={preset === p.id ? "seg selected" : "seg"}
                      aria-pressed={preset === p.id}
                      onClick={() => setPreset(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar-group">
                <span className="toolbar-label">View</span>
                <div className="segmented" role="group" aria-label="View">
                  <button
                    type="button"
                    className={view === "graph" ? "seg selected" : "seg"}
                    aria-pressed={view === "graph"}
                    onClick={() => setView("graph")}
                  >
                    Graph
                  </button>
                  <button
                    type="button"
                    className={view === "table" ? "seg selected" : "seg"}
                    aria-pressed={view === "table"}
                    onClick={() => setView("table")}
                  >
                    Table
                  </button>
                </div>
              </div>
            </div>

            {preset === "custom" && (
              <div className="custom-range">
                <label>
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
              </div>
            )}

            <p className="muted range-summary">
              Showing {totalInRange} {totalInRange === 1 ? "reading" : "readings"} across{" "}
              {withData.length} vital {withData.length === 1 ? "type" : "types"},{" "}
              {describeRange(range)}.
              {undated > 0 && range.from === null && range.to === null
                ? ` ${undated} ${undated === 1 ? "reading has" : "readings have"} no date and ${undated === 1 ? "is" : "are"} hidden when a date range is set.`
                : ""}
            </p>

            <div className="vitals-blocks">
              {visible.map((kind) => (
                <VitalBlock key={`${kind.id}-${view}`} kind={kind} view={view} />
              ))}
              {visible.length === 0 && <p className="muted">No vitals to show.</p>}
            </div>

            <VitalsDebug requests={requests} kinds={kinds} observationCount={observationCount} />
          </div>
        </div>
      </div>
    </dialog>
  );
}
