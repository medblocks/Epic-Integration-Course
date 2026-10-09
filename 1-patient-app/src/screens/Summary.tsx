// Screen C: the one-page health snapshot.

import { useMemo, useState } from "react";
import type { EpicSession, RequestLog, SummaryData } from "../types";
import { formatClockTime, mapPatient } from "../mapping";
import { ConditionsSection } from "../components/ConditionsSection";
import { MedicationsSection } from "../components/MedicationsSection";
import { LabsSection } from "../components/LabsSection";
import { VitalsSection } from "../components/VitalsSection";
import { VitalsPage } from "../components/VitalsPage";
import { mapVitalKinds } from "../vitals";
import { DebugPanel } from "../components/DebugPanel";

export function SummaryScreen({
  session,
  data,
  tokenLog,
  log,
  onDisconnect,
}: {
  session: EpicSession;
  data: SummaryData;
  tokenLog: RequestLog[];
  log: RequestLog[];
  onDisconnect: () => void;
}) {
  const patient = mapPatient(data.patient);
  const vitalKinds = useMemo(
    () => (data.vitals.ok ? mapVitalKinds(data.vitals.resources) : []),
    [data.vitals],
  );
  const vitalsRequests = log.filter((entry) => entry.section === "vitals");
  const [vitalsOpen, setVitalsOpen] = useState(false);

  return (
    <main className="page">
      <header className="banner">
        <div>
          <div className="banner-label">Showing records for</div>
          <h1 className="banner-name">{patient.name}</h1>
          <div className="banner-details">
            <span>
              Born {patient.birthDate} ({patient.age})
            </span>
            <span>{patient.gender}</span>
            {patient.mrn && <span>MRN: {patient.mrn}</span>}
          </div>
        </div>
        <button type="button" className="secondary" onClick={onDisconnect}>
          Disconnect
        </button>
      </header>

      <ConditionsSection result={data.conditions} />
      <MedicationsSection result={data.medications} />
      <LabsSection result={data.labs} />
      <VitalsSection
        result={data.vitals}
        kinds={vitalKinds}
        requests={vitalsRequests}
        onViewMore={() => setVitalsOpen(true)}
      />

      {vitalsOpen && (
        <VitalsPage
          kinds={vitalKinds}
          patientName={patient.name}
          requests={vitalsRequests}
          observationCount={data.vitals.ok ? data.vitals.resources.length : null}
          onClose={() => setVitalsOpen(false)}
        />
      )}

      <DebugPanel session={session} tokenLog={tokenLog} log={log} />

      <footer className="footer">
        Data from your health system via Epic FHIR. Access token expires at{" "}
        {formatClockTime(session.expires_at)}.
      </footer>
    </main>
  );
}
