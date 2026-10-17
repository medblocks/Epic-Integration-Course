// The Vitals tab: one tile per type, then the selected type's graph or table
// with a date range filter, then the "Add a reading" form. Section 7.

import { useMemo, useState } from "react";
import type { CreateResult } from "../fhir";
import type { Observation, SectionResult, Session } from "../types";
import {
  dateBounds,
  filterKindByDate,
  type DateRange,
  type VitalKind,
} from "../vitals";
import { AddReading } from "./AddReading";
import { ErrorBox } from "./ErrorBox";
import { LineChart } from "./LineChart";

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)"];
const TABLE_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

type PresetId = "all" | "30d" | "90d" | "1y" | "custom";
type View = "graph" | "table";

const PRESETS: { id: PresetId; label: string; days: number | null }[] = [
  { id: "all", label: "All time", days: null },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "1y", label: "Last year", days: 365 },
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

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="toolbar-group">
      <span className="toolbar-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={value === option.id ? "seg selected" : "seg"}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function VitalTile({
  kind,
  selected,
  onSelect,
}: {
  kind: VitalKind;
  selected: boolean;
  onSelect: () => void;
}) {
  const latest = kind.readings[0];
  if (!latest) {
    // A known type with no readings cannot be selected.
    return (
      <div className="tile tile-empty" aria-disabled="true">
        <div className="tile-label">{kind.label}</div>
        <div className="tile-value muted">Not recorded</div>
      </div>
    );
  }
  const count = kind.readings.length;
  return (
    <button
      type="button"
      className={selected ? "tile tile-button tile-selected" : "tile tile-button"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="tile-label">{kind.label}</div>
      <div className="tile-value">{latest.display}</div>
      <div className="tile-meta">{latest.dateText}</div>
      <div className="tile-meta">
        {count} {count === 1 ? "reading" : "readings"}
      </div>
    </button>
  );
}

// The selected type. Mounted with key={kind.id} so the date range, view and
// table toggle reset when another type is selected, and persist across a
// re-fetch of the same type.
function VitalDetail({
  kind,
  session,
  onSave,
  onSaved,
}: {
  kind: VitalKind;
  session: Session;
  onSave: (body: Record<string, unknown>) => Promise<CreateResult>;
  onSaved: () => Promise<void>;
}) {
  const bounds = useMemo(() => dateBounds(kind), [kind]);
  const [preset, setPreset] = useState<PresetId>("all");
  const [customFrom, setCustomFrom] = useState(bounds ? toInputDate(bounds.min) : "");
  const [customTo, setCustomTo] = useState(bounds ? toInputDate(bounds.max) : "");
  const [view, setView] = useState<View>("graph");
  const [expanded, setExpanded] = useState(false);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      return { from: startOfDay(customFrom), to: endOfDay(customTo) };
    }
    const days = PRESETS.find((p) => p.id === preset)?.days ?? null;
    if (days === null) return { from: null, to: null };
    // Presets count back from the start of today.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime() - (days - 1) * DAY, to: null };
  }, [preset, customFrom, customTo]);

  const inRange = useMemo(() => filterKindByDate(kind, range), [kind, range]);
  const rows = expanded ? inRange.readings : inRange.readings.slice(0, TABLE_LIMIT);
  const twoSeries = kind.seriesNames.length > 1;
  const count = inRange.readings.length;

  return (
    <section className="vital-detail" aria-label={kind.label}>
      <div className="vital-detail-head">
        <h3>{kind.label}</h3>
        <span className="muted">
          {count} {count === 1 ? "reading" : "readings"}
          {kind.unit ? ` · ${kind.unit}` : ""}
        </span>
      </div>

      <div className="toolbar">
        <Segmented label="Date range" options={PRESETS} value={preset} onChange={setPreset} />
        <Segmented
          label="View"
          options={[
            { id: "graph" as View, label: "Graph" },
            { id: "table" as View, label: "Table" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {preset === "custom" && (
        <div className="custom-range">
          <label>
            From
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}

      {count === 0 ? (
        <p className="muted chart-empty">No readings in this date range.</p>
      ) : view === "graph" ? (
        <>
          {inRange.points.length >= 2 ? (
            <LineChart
              title={kind.label}
              unit={kind.unit}
              series={kind.seriesNames.map((name, i) => ({ name, color: SERIES_COLORS[i] }))}
              points={inRange.points.map((p) => ({
                key: p.key,
                time: p.time as number,
                dateText: p.dateText,
                values: p.values,
              }))}
            />
          ) : (
            <p className="muted chart-empty">
              {inRange.points.length === 1
                ? "Only one reading can be plotted. A graph needs at least two. Switch to the table view to see it."
                : "These readings have no numeric value, so there is no graph."}
            </p>
          )}
          {inRange.points.length >= 2 && inRange.notPlotted > 0 && (
            <p className="muted chart-note">
              {inRange.notPlotted} {inRange.notPlotted === 1 ? "reading is" : "readings are"} in the
              table but not on the graph, because {inRange.notPlotted === 1 ? "it has" : "they have"}{" "}
              no date, no numeric value, or a different unit.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
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
          {count > TABLE_LIMIT && (
            <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show fewer" : `Show all (${count})`}
            </button>
          )}
        </>
      )}

      <AddReading kind={kind} session={session} onSave={onSave} onSaved={onSaved} />
    </section>
  );
}

export function VitalsTab({
  result,
  kinds,
  session,
  onSave,
  onSaved,
}: {
  result: SectionResult<Observation[]>;
  kinds: VitalKind[];
  session: Session;
  onSave: (body: Record<string, unknown>) => Promise<CreateResult>;
  onSaved: () => Promise<void>;
}) {
  const known = kinds.filter((k) => k.known);
  const others = kinds.filter((k) => !k.known);
  const firstWithData = kinds.find((k) => k.readings.length > 0)?.id ?? null;
  // On load, the first type that has data is selected. A re-fetch keeps the
  // selection as long as the type still has data.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selectedId =
    chosenId && kinds.some((k) => k.id === chosenId && k.readings.length > 0)
      ? chosenId
      : firstWithData;
  const selected = kinds.find((k) => k.id === selectedId) ?? null;

  if (!result.ok) return <ErrorBox error={result.error} />;

  return (
    <>
      <div className="tile-grid">
        {known.map((kind) => (
          <VitalTile
            key={kind.id}
            kind={kind}
            selected={kind.id === selectedId}
            onSelect={() => setChosenId(kind.id)}
          />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <h3 className="other-heading">Other vitals</h3>
          <div className="tile-grid">
            {others.map((kind) => (
              <VitalTile
                key={kind.id}
                kind={kind}
                selected={kind.id === selectedId}
                onSelect={() => setChosenId(kind.id)}
              />
            ))}
          </div>
        </>
      )}

      {selected ? (
        <VitalDetail
          key={selected.id}
          kind={selected}
          session={session}
          onSave={onSave}
          onSaved={onSaved}
        />
      ) : (
        <p className="muted">No vitals on file for this patient.</p>
      )}
    </>
  );
}
