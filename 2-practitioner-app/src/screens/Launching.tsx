// Screen B: progress from reading the launch parameters to the chart being
// ready. The first three steps happen before the redirect to Epic and the
// rest after it. Section 3.

import { ErrorBox } from "../components/ErrorBox";
import type { AppError } from "../types";

export const STEP_LABELS = [
  "Reading launch parameters",
  "Discovering Epic endpoints",
  "Redirecting to Epic",
  "Verifying launch",
  "Loading patient",
  "Loading encounter",
  "Loading vitals",
  "Loading medications",
] as const;

export type StepState = "pending" | "active" | "done" | "failed";

const ICONS: Record<StepState, string> = {
  pending: "○",
  active: "…",
  done: "✓",
  failed: "✕",
};

export function LaunchingScreen({
  steps,
  notes,
  error,
  onStartOver,
}: {
  steps: StepState[];
  // A short note shown after a step, such as "no encounter in this launch".
  notes: (string | null)[];
  error: AppError | null;
  onStartOver: () => void;
}) {
  return (
    <main className="page narrow">
      <header className="hero">
        <h1>VitalCheck</h1>
        <p>Opening the chart…</p>
      </header>

      <section className="card">
        <ol className="steps">
          {STEP_LABELS.map((label, i) => {
            const status = steps[i] ?? "pending";
            return (
              <li key={label} className={`step step-${status}`}>
                <span className="step-icon" aria-hidden="true">
                  {ICONS[status]}
                </span>
                <span>
                  {label}
                  {notes[i] && <span className="step-note"> ({notes[i]})</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {error && (
          <>
            <ErrorBox error={error} />
            <button type="button" className="primary" onClick={onStartOver}>
              Start over
            </button>
          </>
        )}
      </section>
    </main>
  );
}
