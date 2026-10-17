// A red box with a one-line message and an optional collapsible "Details"
// block holding raw text such as an HTTP response body. Section 8.

import type { AppError } from "../types";

export function ErrorBox({ error }: { error: AppError }) {
  return (
    <div className="error-box" role="alert">
      <strong>{error.message}</strong>
      {error.detail && (
        <details>
          <summary>Details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
