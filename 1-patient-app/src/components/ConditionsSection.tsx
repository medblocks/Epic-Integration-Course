import type { Condition, SectionResult } from "../types";
import { mapConditions } from "../mapping";
import { Section, SectionBody, ShowAll, Tag } from "./Section";

export function ConditionsSection({ result }: { result: SectionResult<Condition> }) {
  return (
    <Section title="Conditions">
      <SectionBody result={result} emptyMessage="No conditions on your problem list.">
        {(resources) => {
          const items = mapConditions(resources);
          if (items.length === 0) return <p className="muted">No conditions on your problem list.</p>;
          return (
            <ShowAll
              items={items}
              limit={10}
              render={(c) => (
                <li key={c.key} className="item">
                  <div className="item-main">
                    <span className="item-title">{c.name}</span>
                    <Tag value={c.status} />
                  </div>
                  <div className="item-meta">{c.date}</div>
                </li>
              )}
            />
          );
        }}
      </SectionBody>
    </Section>
  );
}
