// Vitals: a tile per vital type, and for the selected type a graph and a table.

import { useState } from "react";
import type { Observation, RequestLog, SectionResult } from "../types";
import type { VitalKind } from "../vitals";
import { Section, SectionBody } from "./Section";
import { LineChart } from "./LineChart";
import { RequestRow } from "./RequestRow";

// Fixed colour per series position. Colour follows the series, never its rank.
const SERIES_COLORS = ["var(--series-1)", "var(--series-2)"];
const TABLE_LIMIT = 10;

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
    return (
      <div className="vital-card vital-missing">
        <div className="vital-label">{kind.label}</div>
        <div className="vital-value">Not recorded</div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={selected ? "vital-card vital-button vital-selected" : "vital-card vital-button"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="vital-label">{kind.label}</div>
      <div className="vital-value">{latest.display}</div>
      <div className="item-meta">
        <span>{latest.dateText}</span>
        <span>
          {kind.readings.length} {kind.readings.length === 1 ? "reading" : "readings"}
        </span>
      </div>
    </button>
  );
}

function VitalDetail({ kind }: { kind: VitalKind }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? kind.readings : kind.readings.slice(0, TABLE_LIMIT);
  const twoSeries = kind.seriesNames.length > 1;

  return (
    <div className="vital-detail">
      <div className="vital-detail-head">
        <h3>{kind.label}</h3>
        <span className="muted">
          {kind.readings.length} {kind.readings.length === 1 ? "reading" : "readings"}
          {kind.unit ? `, measured in ${kind.unit}` : ""}
        </span>
      </div>

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
            ? "Only one reading can be plotted. A graph needs at least two."
            : "These readings have no numeric value, so there is no graph."}
        </p>
      )}

      {kind.points.length >= 2 && kind.notPlotted > 0 && (
        <p className="muted chart-note">
          {kind.notPlotted} {kind.notPlotted === 1 ? "reading is" : "readings are"} in the table but
          not on the graph, because {kind.notPlotted === 1 ? "it has" : "they have"} no date, no
          numeric value, or a different unit.
        </p>
      )}

      {/* Wide tables scroll inside their own box instead of stretching the page. */}
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
    </div>
  );
}

function VitalsBody({ kinds }: { kinds: VitalKind[] }) {
  const withData = kinds.filter((k) => k.readings.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(withData[0]?.id ?? null);
  const selected = withData.find((k) => k.id === selectedId) ?? withData[0] ?? null;
  const known = kinds.filter((k) => k.known);
  const others = kinds.filter((k) => !k.known);

  return (
    <>
      <div className="vital-grid">
        {known.map((kind) => (
          <VitalTile
            key={kind.id}
            kind={kind}
            selected={selected?.id === kind.id}
            onSelect={() => setSelectedId(kind.id)}
          />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <h3>Other vitals</h3>
          <div className="vital-grid">
            {others.map((kind) => (
              <VitalTile
                key={kind.id}
                kind={kind}
                selected={selected?.id === kind.id}
                onSelect={() => setSelectedId(kind.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* key resets the table's "Show all" state when another vital is selected */}
      {selected && <VitalDetail key={selected.id} kind={selected} />}
    </>
  );
}

export function VitalsDebug({
  requests,
  kinds,
  observationCount,
}: {
  requests: RequestLog[];
  kinds: VitalKind[];
  observationCount: number | null;
}) {
  const withData = kinds.filter((k) => k.readings.length > 0);
  return (
    <details className="section-debug debug">
      <summary>Debug: vitals requests</summary>
      <p className="debug-note">
        The requests behind this section. Click one to see its headers, including the bearer token,
        and the response body. Sandbox test data only.
      </p>
      {requests.length === 0 && <p className="debug-note">No vitals request was made.</p>}
      {requests.map((entry, i) => (
        <RequestRow key={i} entry={entry} />
      ))}

      {observationCount !== null && (
        <>
          <h4>How the response was grouped</h4>
          <p className="debug-note">
            {observationCount} {observationCount === 1 ? "observation" : "observations"} grouped
            into {withData.length} vital {withData.length === 1 ? "type" : "types"}.
          </p>
          {withData.length > 0 && (
            <div className="table-scroll">
              <table className="vital-table debug-grouping">
                <thead>
                  <tr>
                    <th>Vital</th>
                    <th>Matched on</th>
                    <th className="num">Readings</th>
                    <th className="num">On graph</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {withData.map((kind) => (
                    <tr key={kind.id}>
                      <td>{kind.label}</td>
                      <td>{kind.known ? `LOINC ${kind.codes.join(", ")}` : "code text"}</td>
                      <td className="num">{kind.readings.length}</td>
                      <td className="num">{kind.points.length}</td>
                      <td>{kind.unit || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </details>
  );
}

export function VitalsSection({
  result,
  kinds,
  requests,
  onViewMore,
}: {
  result: SectionResult<Observation>;
  kinds: VitalKind[];
  requests: RequestLog[];
  onViewMore: () => void;
}) {
  const hasData = kinds.some((k) => k.readings.length > 0);

  return (
    <Section
      title="Vitals"
      action={
        hasData && (
          <button type="button" className="secondary small" onClick={onViewMore}>
            View more
          </button>
        )
      }
    >
      <SectionBody result={result} emptyMessage="No vitals on file.">
        {() => <VitalsBody kinds={kinds} />}
      </SectionBody>
      <VitalsDebug
        requests={requests}
        kinds={kinds}
        observationCount={result.ok ? result.resources.length : null}
      />
    </Section>
  );
}
