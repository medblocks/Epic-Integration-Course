import type { MedicationRequest, SectionResult } from "../types";
import { mapMedications } from "../mapping";
import { Section, SectionBody, ShowAll, Tag } from "./Section";

export function MedicationsSection({ result }: { result: SectionResult<MedicationRequest> }) {
  return (
    <Section title="Medications">
      <SectionBody result={result} emptyMessage="No medications on file.">
        {(resources) => (
          <ShowAll
            items={mapMedications(resources)}
            limit={10}
            render={(m) => (
              <li key={m.key} className="item">
                <div className="item-main">
                  <span className="item-title">{m.name}</span>
                  <Tag value={m.status} />
                </div>
                <div className="item-body">{m.instructions}</div>
                <div className="item-meta">
                  <span>{m.date}</span>
                  {m.prescriber && <span>Prescribed by {m.prescriber}</span>}
                </div>
              </li>
            )}
          />
        )}
      </SectionBody>
    </Section>
  );
}
