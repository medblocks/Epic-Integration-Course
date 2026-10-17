// Screen C: the chart. Patient banner, encounter line, Vitals and Medications
// tabs, the FHIR panel, and a footer. Section 3.

import { useEffect, useMemo, useState } from "react";
import { ErrorBox } from "../components/ErrorBox";
import { FhirPanel } from "../components/FhirPanel";
import { MedicationsTab } from "../components/MedicationsTab";
import { VitalsTab } from "../components/VitalsTab";
import type { CreateResult } from "../fhir";
import { formatClockTime, mapEncounter, mapPatient } from "../mapping";
import type { ChartData, EncounterState, Session } from "../types";
import { mapVitalKinds } from "../vitals";

type Tab = "vitals" | "medications";

// True on screens 1100px and wider, where the FHIR panel is a right-hand
// column. Below that it is a collapsible block at the bottom of the page.
function useWideLayout(): boolean {
  const query = "(min-width: 1100px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

function EncounterLine({ encounter }: { encounter: EncounterState }) {
  if (encounter.kind === "none") {
    return (
      <p className="encounter-line encounter-warn">
        Visit: none in this launch. New readings cannot be saved.
      </p>
    );
  }
  if (encounter.kind === "failed") {
    return (
      <p className="encounter-line">
        Visit: Encounter/{encounter.id} (details could not be loaded)
      </p>
    );
  }
  const e = mapEncounter(encounter.resource);
  return (
    <p className="encounter-line">
      Visit: {e.className} · {e.status} · started {e.start}
      {e.place ? ` · ${e.place}` : ""}
    </p>
  );
}

export function ChartScreen({
  session,
  data,
  launchedThisLoad,
  onClose,
  onSave,
  onRefreshVitals,
}: {
  session: Session;
  data: ChartData;
  launchedThisLoad: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<CreateResult>;
  onRefreshVitals: () => Promise<void>;
}) {
  const wide = useWideLayout();
  const [tab, setTab] = useState<Tab>("vitals");
  const [panelOpen, setPanelOpen] = useState(false);

  const kinds = useMemo(
    () => (data.vitals.ok ? mapVitalKinds(data.vitals.data) : []),
    [data.vitals],
  );
  const patient = data.patient.ok ? mapPatient(data.patient.data) : null;

  const panel = (
    <FhirPanel
      session={session}
      launchedThisLoad={launchedThisLoad}
      vitals={data.vitals.ok ? { kinds, observationCount: data.vitals.data.length } : null}
    />
  );

  return (
    <div className="chart-screen">
      <header className="app-header">
        <span className="app-name">VitalCheck</span>
        <div className="header-actions">
          {!wide && (
            <button
              type="button"
              className="secondary small"
              aria-expanded={panelOpen}
              aria-controls="fhir-panel"
              onClick={() => setPanelOpen((v) => !v)}
            >
              FHIR panel
            </button>
          )}
          <button type="button" className="secondary small" onClick={onClose}>
            Close session
          </button>
        </div>
      </header>

      <div className={wide ? "chart-layout wide" : "chart-layout"}>
        <main className="chart-main">
          <section className="banner" aria-label="Patient">
            <div className="banner-label">Showing chart for</div>
            {patient ? (
              <>
                <div className="banner-name">{patient.name}</div>
                <div className="banner-details">
                  <span>{patient.birthDateWithAge}</span>
                  <span>{patient.gender}</span>
                  {patient.mrn && <span>MRN: {patient.mrn}</span>}
                </div>
              </>
            ) : (
              <div className="banner-name">Patient/{session.patient} (details could not be loaded)</div>
            )}
          </section>
          {!data.patient.ok && <ErrorBox error={data.patient.error} />}

          <EncounterLine encounter={data.encounter} />

          <div className="tabs" role="tablist" aria-label="Chart sections">
            <button
              type="button"
              role="tab"
              id="tab-vitals"
              aria-selected={tab === "vitals"}
              aria-controls="tabpanel-vitals"
              className={tab === "vitals" ? "tab selected" : "tab"}
              onClick={() => setTab("vitals")}
            >
              Vitals
            </button>
            <button
              type="button"
              role="tab"
              id="tab-medications"
              aria-selected={tab === "medications"}
              aria-controls="tabpanel-medications"
              className={tab === "medications" ? "tab selected" : "tab"}
              onClick={() => setTab("medications")}
            >
              Medications
            </button>
          </div>

          {/* Both tabs stay mounted so switching never refetches and never
              loses the vitals selection. The hidden one is display: none. */}
          <section
            id="tabpanel-vitals"
            role="tabpanel"
            aria-labelledby="tab-vitals"
            className="card tabpanel"
            hidden={tab !== "vitals"}
          >
            <VitalsTab
              result={data.vitals}
              kinds={kinds}
              session={session}
              onSave={onSave}
              onSaved={onRefreshVitals}
            />
          </section>
          <section
            id="tabpanel-medications"
            role="tabpanel"
            aria-labelledby="tab-medications"
            className="card tabpanel"
            hidden={tab !== "medications"}
          >
            <MedicationsTab result={data.medications} />
          </section>

          <footer className="footer">
            Data from {session.fhir_base_url} via Epic FHIR. Access token expires at{" "}
            {formatClockTime(session.expires_at)}.
          </footer>
        </main>

        {wide ? (
          <aside className="panel-column" id="fhir-panel">
            {panel}
          </aside>
        ) : (
          panelOpen && (
            <section className="panel-bottom" id="fhir-panel">
              {panel}
            </section>
          )
        )}
      </div>
    </div>
  );
}
