// Screen A: the launch screen. In a hospital it is never seen, because Epic
// opens the app with the patient already selected. It carries a manual launch
// form for testing outside Epic. Section 3.

import { useState } from "react";
import { ErrorBox } from "../components/ErrorBox";
import { CLIENT_ID, SANDBOX_FHIR_BASE_URL } from "../config";
import { NO_CLIENT_ID_MESSAGE } from "../oauth";
import type { AppError } from "../types";

export function LaunchScreen({
  error,
  onLaunch,
}: {
  error: AppError | null;
  onLaunch: (fhirBaseUrl: string, clientId: string, launchToken: string) => void;
}) {
  const [fhirBaseUrl, setFhirBaseUrl] = useState(SANDBOX_FHIR_BASE_URL);
  const [clientId, setClientId] = useState(CLIENT_ID);
  const [launchToken, setLaunchToken] = useState("");
  const ready = fhirBaseUrl.trim() !== "" && clientId.trim() !== "" && launchToken.trim() !== "";

  return (
    <main className="page narrow">
      <header className="hero">
        <h1>VitalCheck</h1>
        <p>
          VitalCheck is opened from inside Epic. Epic passes the patient and the visit, and the app
          shows that patient's vitals.
        </p>
      </header>

      {error && <ErrorBox error={error} />}
      {CLIENT_ID === "" && <div className="notice-box">{NO_CLIENT_ID_MESSAGE}</div>}

      <section className="card">
        <h2>Launch manually</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onLaunch(fhirBaseUrl.trim(), clientId.trim(), launchToken.trim());
          }}
        >
          <label className="field">
            <span>FHIR base URL</span>
            <input
              type="text"
              value={fhirBaseUrl}
              onChange={(e) => setFhirBaseUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Launch token</span>
            <input
              type="text"
              value={launchToken}
              onChange={(e) => setLaunchToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="hint">
              Paste the launch value from Epic's launcher URL. Open fhir.epic.com, go to
              Documentation, Launching your app from Epic, and use Try It.
            </small>
          </label>
          <button type="submit" className="primary wide" disabled={!ready}>
            Launch
          </button>
        </form>
      </section>

      <p className="note">
        In a hospital this screen is never seen. Epic opens the app with the patient already
        selected.
      </p>
    </main>
  );
}
