// "Add a reading": writes one Observation to Epic for the selected type.
// Section 7, "Add a reading". Everything except the value is copied from the
// most recent reading of the type (see writeTemplate in vitals.ts).

import { useState, type FormEvent } from "react";
import { CreateError, type CreateResult } from "../fhir";
import { NetworkError } from "../http";
import type { AppError, Session } from "../types";
import { buildObservationBody, writeTemplate, type VitalKind } from "../vitals";
import { ErrorBox } from "./ErrorBox";

function filedTimeText(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AddReading({
  kind,
  session,
  onSave,
  onSaved,
}: {
  // The unfiltered type, so the most recent reading is the true latest.
  kind: VitalKind;
  session: Session;
  // Sends the body to Epic. Throws CreateError, NetworkError, or rethrows
  // after the session has been expired by the caller.
  onSave: (body: Record<string, unknown>) => Promise<CreateResult>;
  // Re-fetches the vitals from Epic after a successful save.
  onSaved: () => Promise<void>;
}) {
  const template = writeTemplate(kind, session);
  const fieldCount = template.ok ? template.fields.length : 0;
  const [values, setValues] = useState<string[]>(() => Array(fieldCount).fill(""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Set when the form opens (the component mounts for a type), not every second.
  const [filedAt, setFiledAt] = useState(() => new Date());

  if (!template.ok) {
    return (
      <section className="add-reading add-reading-disabled" aria-label="Add a reading">
        <h3>Add a reading</h3>
        <p className="muted">{template.reason}</p>
      </section>
    );
  }

  const numbers = values.map((v) => (v.trim() === "" ? NaN : Number(v)));
  const complete = numbers.length === fieldCount && numbers.every((n) => Number.isFinite(n));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!template.ok || !complete || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const body = buildObservationBody(kind, template.source, numbers, session);
      const result = await onSave(body);
      setValues(Array(fieldCount).fill(""));
      setSuccess(`Saved. Reading ${result.newId ?? "created"} is now in the chart.`);
      setFiledAt(new Date());
      await onSaved();
    } catch (caught) {
      // The typed values are kept so the clinician can retry.
      if (caught instanceof CreateError) {
        setError({
          message: `Epic rejected the reading with HTTP ${caught.status}.${caught.outcomeText ? ` ${caught.outcomeText}` : ""}`,
          detail: caught.body || "Empty response body.",
        });
      } else if (caught instanceof NetworkError) {
        setError({ message: caught.message });
      } else {
        setError({ message: caught instanceof Error ? caught.message : "Unexpected error." });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="add-reading" aria-label="Add a reading">
      <h3>Add a reading</h3>
      <form onSubmit={submit}>
        <div className="reading-fields">
          {template.fields.map((field, i) => (
            <label key={field.label} className="reading-field">
              <span>{field.label}</span>
              <span className="input-with-unit">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={values[i] ?? ""}
                  disabled={saving}
                  onChange={(e) => {
                    const next = [...values];
                    next[i] = e.target.value;
                    setValues(next);
                  }}
                />
                <span className="unit-suffix" aria-label="unit">
                  {field.unit}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="muted filed-as">
          Will be filed as {template.codeText} ({template.codingText}) at {filedTimeText(filedAt)}{" "}
          for Encounter/{session.encounter}.
        </p>
        <button type="submit" className="primary" disabled={!complete || saving}>
          {saving ? "Saving…" : "Save to Epic"}
        </button>
        {success && (
          <p className="success-line" role="status">
            {success}
          </p>
        )}
        {error && <ErrorBox error={error} />}
      </form>
    </section>
  );
}
