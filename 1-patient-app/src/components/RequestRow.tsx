// One expandable row per HTTP request: headers, request body, response body.
// Used by the Debug panel and by the Vitals section's own request list.

import { useState } from "react";
import type { RequestLog } from "../types";

// Pretty-print JSON with 2-space indentation. Anything else is shown as received.
function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// Form-encoded bodies are shown one parameter per line, the same way the
// token request is written out in the specification.
function formatRequestBody(entry: RequestLog): string {
  const body = entry.requestBody ?? "";
  const contentType = entry.requestHeaders["Content-Type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return body.split("&").join("\n&");
  }
  return formatBody(body);
}

export function RequestRow({ entry }: { entry: RequestLog }) {
  // The payload is only rendered while the row is open. A vitals Bundle can be
  // hundreds of kilobytes, so rendering every body up front would be wasteful.
  const [open, setOpen] = useState(false);
  const ok = typeof entry.status === "number" && entry.status >= 200 && entry.status < 300;

  return (
    <details className="request" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="method">{entry.method}</span>
        <span className="url">{entry.url}</span>
        <span className={ok ? "status status-ok" : "status status-bad"}>{entry.status}</span>
        <span className="count">
          {entry.count === null ? "" : `${entry.count} ${entry.count === 1 ? "resource" : "resources"}`}
        </span>
      </summary>
      {open && (
        <div className="request-detail">
          <h4>Request headers</h4>
          <pre className="request-headers">
            {Object.entries(entry.requestHeaders)
              .map(([name, value]) => `${name}: ${value}`)
              .join("\n")}
          </pre>

          <h4>Request body</h4>
          {entry.requestBody ? (
            <pre className="request-body">{formatRequestBody(entry)}</pre>
          ) : (
            <p className="muted">No request body. {entry.method} requests do not send one.</p>
          )}

          <h4>Response body</h4>
          {entry.responseBody ? (
            <pre className="response-body">{formatBody(entry.responseBody)}</pre>
          ) : (
            <p className="muted">No response body was received.</p>
          )}
        </div>
      )}
    </details>
  );
}
