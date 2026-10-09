// Section 9: a learner-facing panel. It shows what was really sent to Epic and
// what came back, including the bearer token. That is acceptable only because
// this app runs against the Epic sandbox with test patients.

import type { EpicSession, RequestLog } from "../types";
import { formatDateTime } from "../mapping";
import { RequestRow } from "./RequestRow";

export function DebugPanel({
  session,
  tokenLog,
  log,
}: {
  session: EpicSession;
  tokenLog: RequestLog[];
  log: RequestLog[];
}) {
  return (
    <details className="card debug">
      <summary>Debug</summary>
      <dl className="debug-facts">
        <dt>patient</dt>
        <dd>{session.patient || "Not recorded"}</dd>
        <dt>fhirUser</dt>
        <dd>{session.fhirUser || "Not present in ID token"}</dd>
        <dt>scope</dt>
        <dd>{session.scope || "Not recorded"}</dd>
        <dt>expires_at</dt>
        <dd>{formatDateTime(session.expires_at)}</dd>
      </dl>

      <p className="debug-note">
        Click a request to see its headers, including the bearer token, and the request and
        response bodies. Sandbox test data only.
      </p>

      <h3>Token request</h3>
      {tokenLog.length > 0 ? (
        tokenLog.map((entry, i) => <RequestRow key={i} entry={entry} />)
      ) : (
        <p className="debug-note">
          No token request was made on this page load. The saved session was reused. Disconnect
          and connect again to see it.
        </p>
      )}

      <h3>FHIR requests</h3>
      {log.map((entry, i) => (
        <RequestRow key={i} entry={entry} />
      ))}
    </details>
  );
}
