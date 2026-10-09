// Minimal FHIR R4 shapes: only the fields this app reads. Every field is
// optional because every field can be missing in real data.

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  text?: string;
  coding?: Coding[];
}

export interface Quantity {
  value?: number;
  unit?: string;
  code?: string;
  system?: string;
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface Identifier {
  value?: string;
  type?: CodeableConcept;
}

export interface HumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
}

export interface Patient {
  resourceType: "Patient";
  id?: string;
  name?: HumanName[];
  birthDate?: string;
  gender?: string;
  identifier?: Identifier[];
}

export interface Condition {
  resourceType: "Condition";
  id?: string;
  code?: CodeableConcept;
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  onsetDateTime?: string;
  recordedDate?: string;
}

export interface MedicationRequest {
  resourceType: "MedicationRequest";
  id?: string;
  status?: string;
  medicationCodeableConcept?: CodeableConcept;
  medicationReference?: Reference;
  dosageInstruction?: { text?: string }[];
  authoredOn?: string;
  requester?: Reference;
}

export interface ObservationComponent {
  code?: CodeableConcept;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
}

export interface ReferenceRange {
  text?: string;
  low?: Quantity;
  high?: Quantity;
}

export interface Observation {
  resourceType: "Observation";
  id?: string;
  code?: CodeableConcept;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  component?: ObservationComponent[];
  referenceRange?: ReferenceRange[];
  interpretation?: CodeableConcept[];
  effectiveDateTime?: string;
  issued?: string;
}

export interface OperationOutcome {
  resourceType: "OperationOutcome";
  issue?: {
    severity?: string;
    diagnostics?: string;
    details?: { text?: string };
  }[];
}

export interface Bundle {
  resourceType: "Bundle";
  link?: { relation?: string; url?: string }[];
  entry?: { resource?: AnyResource }[];
}

export type AnyResource =
  | Patient
  | Condition
  | MedicationRequest
  | Observation
  | OperationOutcome
  | Bundle
  | { resourceType: string };

// Saved in sessionStorage under "epic_session". Section 5 of the spec.
export interface EpicSession {
  access_token: string;
  expires_at: number;
  patient: string;
  fhir_base_url: string;
  scope: string;
  fhirUser: string;
}

// One entry in the debug panel per HTTP request made to Epic. Filled in by the
// same function that calls fetch, so it records what was really sent and
// received. Kept in memory only; never written to sessionStorage.
// Which part of the app made the request. Lets a section show its own requests.
export type RequestSection = "token" | "patient" | "conditions" | "medications" | "labs" | "vitals";

export interface RequestLog {
  section: RequestSection;
  method: "GET" | "POST";
  url: string;
  status: number | string;
  // Number of resources returned. null for the token request, where it has no meaning.
  count: number | null;
  // Headers exactly as sent, including the Authorization header.
  requestHeaders: Record<string, string>;
  // Body exactly as sent. null when the request has no body (every GET).
  requestBody: string | null;
  // Raw response text. null if no response arrived (network failure).
  responseBody: string | null;
}

// The outcome of loading one section of Screen C. A failed section still
// renders; it just shows its error instead of data.
export type SectionResult<T> =
  | { ok: true; resources: T[] }
  | { ok: false; message: string; detail?: string };

export interface SummaryData {
  patient: Patient;
  conditions: SectionResult<Condition>;
  medications: SectionResult<MedicationRequest>;
  labs: SectionResult<Observation>;
  vitals: SectionResult<Observation>;
}
