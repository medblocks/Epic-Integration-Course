// Screen B: progress through token exchange and the five FHIR requests.

import { ErrorBox } from "../components/ErrorBox";

export const STEP_LABELS = [
  "Verifying login",
  "Loading patient",
  "Loading conditions",
  "Loading medications",
  "Loading lab results",
  "Loading vitals",
] as const;

export type StepState = "pending" | "active" | "done" | "failed";

export interface LoadError {
  message: string;
  detail?: string;
}

const ICONS: Record<StepState, string> = {
  pending: "○",
  active: "…",
  done: "✓",
  failed: "✕",
};

export function LoadingScreen({
  steps,
  error,
  onStartOver,
}: {
  steps: StepState[];
  error: LoadError | null;
  onStartOver: () => void;
}) {
  return (
    <main className="page narrow">
      <header className="hero">
        <h1>CareSummary</h1>
        <p>Loading your record…</p>
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
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        {error && (
          <>
            <ErrorBox title={error.message}>
              {error.detail && (
                <details>
                  <summary>Details</summary>
                  <pre>{error.detail}</pre>
                </details>
              )}
            </ErrorBox>
            <button type="button" className="primary" onClick={onStartOver}>
              Start over
            </button>
          </>
        )}
      </section>
    </main>
  );
}
