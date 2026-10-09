// Shared shell for the four Screen C sections: heading, section-level error,
// empty state, and the "Show all (N)" toggle.

import { useState, type ReactNode } from "react";
import type { SectionResult } from "../types";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  // Optional control shown at the top right of the heading, e.g. "View more".
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Renders the section error when the request failed, otherwise the body.
export function SectionBody<T>({
  result,
  emptyMessage,
  children,
}: {
  result: SectionResult<T>;
  emptyMessage: string;
  children: (resources: T[]) => ReactNode;
}) {
  if (!result.ok) {
    return (
      <div className="error-box" role="alert">
        <strong>{result.message}</strong>
        {result.detail && (
          <details>
            <summary>Details</summary>
            <pre>{result.detail}</pre>
          </details>
        )}
      </div>
    );
  }
  if (result.resources.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }
  return <>{children(result.resources)}</>;
}

// Shows at most `limit` items with a toggle to expand to the full list.
export function ShowAll<T>({
  items,
  limit,
  render,
}: {
  items: T[];
  limit: number;
  render: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  return (
    <>
      <ul className="item-list">{visible.map(render)}</ul>
      {items.length > limit && (
        <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all (${items.length})`}
        </button>
      )}
    </>
  );
}

export function Tag({ value }: { value: string | null }) {
  if (!value) return null;
  return <span className={`tag tag-${value.toLowerCase().replace(/[^a-z-]/g, "")}`}>{value}</span>;
}
