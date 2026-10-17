// The Medications tab: MedicationRequest resources, active first. Section 7.

import { useState } from "react";
import { mapMedications } from "../mapping";
import type { MedicationRequest, SectionResult } from "../types";
import { ErrorBox } from "./ErrorBox";

const LIMIT = 10;

export function MedicationsTab({ result }: { result: SectionResult<MedicationRequest[]> }) {
  const [expanded, setExpanded] = useState(false);

  if (!result.ok) return <ErrorBox error={result.error} />;

  const medications = mapMedications(result.data);
  if (medications.length === 0) return <p className="muted">No medications on file.</p>;

  const shown = expanded ? medications : medications.slice(0, LIMIT);
  return (
    <>
      <ul className="item-list">
        {shown.map((m) => (
          <li key={m.key} className="item">
            <div className="item-main">
              <span className="item-title">{m.name}</span>
              {m.status && (
                <span className={m.status === "active" ? "tag tag-active" : "tag"}>{m.status}</span>
              )}
            </div>
            <div className="item-body">{m.instructions}</div>
            <div className="item-meta">
              <span>{m.date}</span>
              {m.prescriber && <span>Prescribed by {m.prescriber}</span>}
            </div>
          </li>
        ))}
      </ul>
      {medications.length > LIMIT && (
        <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all (${medications.length})`}
        </button>
      )}
    </>
  );
}
