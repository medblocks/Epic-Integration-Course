// Section 9: the learner-facing panel. It shows what was really sent to Epic
// and what came back, including the bearer token and raw payloads. That is
// acceptable only because this app runs against the Epic sandbox with test
// patients. Remove the token and the payloads before real patient data.

import { useRequestLog } from "../log";
import { formatDateTime } from "../mapping";
import type { RequestLog, RequestSection, Session } from "../types";
import type { VitalKind } from "../vitals";
import { RequestRow } from "./RequestRow";

const GROUPS: { section: RequestSection; title: string }[] = [
  { section: "discovery", title: "Discovery" },
  { section: "token", title: "Token" },
  { section: "patient", title: "Patient" },
  { section: "encounter", title: "Encounter" },
  { section: "vitals", title: "Vitals" },
  { section: "medications", title: "Medications" },
  { section: "create", title: "Writes" },
];

const REUSED_NOTE =
  "No request was made on this page load. The saved session was reused. Launch again from Epic to see it.";

export function VitalsGrouping({
  kinds,
  observationCount,
}: {
  kinds: VitalKind[];
  observationCount: number;
}) {
  const withData = kinds.filter((k) => k.readings.length > 0);
  return (
    <div className="grouping">
      <h4>How the response was grouped</h4>
      <p className="panel-note">
        {observationCount} {observationCount === 1 ? "observation" : "observations"} grouped into{" "}
        {withData.length} vital {withData.length === 1 ? "type" : "types"}.
      </p>
      {withData.length > 0 && (
        <div className="table-scroll">
          <table className="data-table grouping-table">
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
    </div>
  );
}

export function FhirPanel({
  session,
  launchedThisLoad,
  vitals,
}: {
  session: Session;
  // True when this page load handled the launch and the redirect, so the
  // discovery and token rows exist.
  launchedThisLoad: boolean;
  // Grouping of the current vitals, or null when the vitals request failed.
  vitals: { kinds: VitalKind[]; observationCount: number } | null;
}) {
  const entries = useRequestLog();
  const bySection = (section: RequestSection): RequestLog[] =>
    entries.filter((e) => e.section === section);

  return (
    <div className="fhir-panel">
      <h2>FHIR panel</h2>

      <h3>Launch context</h3>
      <dl className="context-list">
        <dt>FHIR base URL</dt>
        <dd>{session.fhir_base_url}</dd>
        <dt>patient</dt>
        <dd>{session.patient || "none"}</dd>
        <dt>encounter</dt>
        <dd>{session.encounter ?? "none"}</dd>
        <dt>fhirUser</dt>
        <dd>{session.fhirUser || "none"}</dd>
        <dt>scope</dt>
        <dd>{session.scope || "none"}</dd>
        <dt>expires_at</dt>
        <dd>{formatDateTime(session.expires_at)}</dd>
      </dl>

      <h3>Requests</h3>
      <p className="panel-note">
        Click a request to see its headers, including the bearer token, and the request and
        response bodies. Sandbox test data only.
      </p>

      {GROUPS.map((group) => {
        const rows = bySection(group.section);
        const reusedNote =
          rows.length === 0 &&
          !launchedThisLoad &&
          (group.section === "discovery" || group.section === "token");
        // The Vitals heading always shows so a failed request can be inspected.
        if (rows.length === 0 && !reusedNote && group.section !== "vitals") return null;
        return (
          <section key={group.section} className="panel-group">
            <h4>{group.title}</h4>
            {reusedNote && <p className="panel-note">{REUSED_NOTE}</p>}
            {rows.length === 0 && group.section === "vitals" && !reusedNote && (
              <p className="panel-note">No vitals request was made.</p>
            )}
            {rows.map((entry, i) => (
              <RequestRow key={`${group.section}-${i}`} entry={entry} />
            ))}
            {group.section === "vitals" && vitals && (
              <VitalsGrouping kinds={vitals.kinds} observationCount={vitals.observationCount} />
            )}
          </section>
        );
      })}
    </div>
  );
}
