// One expandable row per HTTP request: headers, request body, response body.
// Section 9. The payload is only rendered while the row is open, because a
// vitals Bundle can be hundreds of kilobytes.

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

// Form-encoded bodies are shown one parameter per line.
function formatRequestBody(entry: RequestLog): string {
  const body = entry.requestBody ?? "";
  const contentType = entry.requestHeaders["Content-Type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return body.split("&").join("\n&");
  }
  return formatBody(body);
}

export function RequestRow({ entry }: { entry: RequestLog }) {
  const [open, setOpen] = useState(false);
  const ok = typeof entry.status === "number" && entry.status >= 200 && entry.status < 300;
  const isSearch = entry.count !== null;

  return (
    <details className="request" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="method">{entry.method}</span>
        <span className="url">{entry.url}</span>
        <span className={ok ? "status status-ok" : "status status-bad"}>{entry.status}</span>
        <span className="count">
          {isSearch ? `${entry.count} ${entry.count === 1 ? "resource" : "resources"}` : ""}
        </span>
      </summary>
      {open && (
        <div className="request-detail">
          <h4>Request headers</h4>
          <pre>
            {Object.entries(entry.requestHeaders)
              .map(([name, value]) => `${name}: ${value}`)
              .join("\n")}
          </pre>

          <h4>Request body</h4>
          {entry.requestBody ? (
            <pre>{formatRequestBody(entry)}</pre>
          ) : (
            <p className="muted">No request body. GET requests do not send one.</p>
          )}

          <h4>Response body</h4>
          {entry.responseBody ? (
            <pre>{formatBody(entry.responseBody)}</pre>
          ) : (
            <>
              <p className="muted">
                {entry.status === "pending"
                  ? "Waiting for the response."
                  : entry.status === "network error"
                    ? "No response arrived. The request did not reach Epic."
                    : "Empty response body."}
              </p>
              {entry.responseLocation && (
                <p className="muted">Location: {entry.responseLocation}</p>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
