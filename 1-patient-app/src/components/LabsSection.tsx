import type { Observation, SectionResult } from "../types";
import { mapLabs } from "../mapping";
import { Section, SectionBody, ShowAll } from "./Section";

function Flag({ flag }: { flag: string | null }) {
  if (!flag) return null;
  const marked = flag === "H" || flag === "L" || flag === "HH" || flag === "LL";
  return (
    <span className={marked ? "flag flag-marked" : "flag"} title="Interpretation">
      {flag}
    </span>
  );
}

export function LabsSection({ result }: { result: SectionResult<Observation> }) {
  return (
    <Section title="Lab results">
      <SectionBody result={result} emptyMessage="No lab results on file.">
        {(resources) => (
          <ShowAll
            items={mapLabs(resources)}
            limit={15}
            render={(lab) => (
              <li key={lab.key} className="item">
                <div className="item-main">
                  <span className="item-title">{lab.name}</span>
                  <Flag flag={lab.flag} />
                </div>
                <div className="item-body">
                  {lab.valueLines.map((line, i) => (
                    <div key={i} className="value">
                      {line}
                    </div>
                  ))}
                  {lab.referenceRange && <div className="muted">Reference: {lab.referenceRange}</div>}
                </div>
                <div className="item-meta">
                  <span>{lab.date}</span>
                  {lab.earlierCount > 0 && <span>({lab.earlierCount} earlier results)</span>}
                </div>
              </li>
            )}
          />
        )}
      </SectionBody>
    </Section>
  );
}
