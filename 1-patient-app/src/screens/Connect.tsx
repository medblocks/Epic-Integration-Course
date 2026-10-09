// Screen A: pick a health system, then press the connect button to start the
// OAuth flow. Selecting an organisation does not navigate anywhere by itself.

import { useState } from "react";
import { CLIENT_ID, ORGANIZATIONS } from "../config";
import { beginConnect } from "../oauth";
import { ErrorBox } from "../components/ErrorBox";

export interface ConnectError {
  title: string;
  description?: string;
}

export function ConnectScreen({ error }: { error: ConnectError | null }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const hasClientId = CLIENT_ID.trim().length > 0;

  const filtered = ORGANIZATIONS.filter((org) =>
    org.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // A selection only counts while it is visible. If the search hides the
  // selected organisation, the connect button goes back to disabled so the
  // user never connects to something they cannot see.
  const selected = filtered.find((org) => org.id === selectedId) ?? null;

  async function connect() {
    if (!selected) return;
    setConnecting(true);
    await beginConnect(selected);
  }

  return (
    <main className="page narrow">
      <header className="hero">
        <h1>CareSummary</h1>
        <p>
          Connect your health record to see a one-page summary of your conditions, medications,
          and recent results.
        </p>
      </header>

      {error && (
        <ErrorBox title={error.title}>
          {error.description && <p>{error.description}</p>}
        </ErrorBox>
      )}

      {!hasClientId && (
        <ErrorBox title="No client ID is configured. Set VITE_EPIC_CLIENT_ID in .env and restart the dev server." />
      )}

      <section className="card">
        <label className="field">
          <span>Find your health system</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            autoComplete="off"
          />
        </label>

        <ul className="org-list">
          {filtered.map((org) => {
            const isSelected = selected?.id === org.id;
            return (
              <li key={org.id}>
                <button
                  type="button"
                  className={isSelected ? "org-option org-selected" : "org-option"}
                  aria-pressed={isSelected}
                  disabled={!hasClientId || connecting}
                  onClick={() => setSelectedId(org.id)}
                >
                  <span className="org-radio" aria-hidden="true" />
                  <span>{org.name}</span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="muted">No health systems match your search.</li>}
        </ul>

        <button
          type="button"
          className="connect-button"
          disabled={!hasClientId || !selected || connecting}
          onClick={() => void connect()}
        >
          Connect your health records
        </button>

        <p className="note">
          You will be taken to your health system's MyChart login. CareSummary never sees your
          password.
        </p>
      </section>
    </main>
  );
}
