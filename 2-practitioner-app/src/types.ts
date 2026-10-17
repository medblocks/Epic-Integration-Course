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

export interface Encounter {
  resourceType: "Encounter";
  id?: string;
  status?: string;
  class?: Coding;
  period?: { start?: string; end?: string };
  serviceProvider?: Reference;
  location?: { location?: Reference }[];
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

export interface Observation {
  resourceType: "Observation";
  id?: string;
  code?: CodeableConcept;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  component?: ObservationComponent[];
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
  | Encounter
  | MedicationRequest
  | Observation
  | OperationOutcome
  | Bundle
  | { resourceType: string };

// Saved in sessionStorage under "vc_session". Section 5 of the spec.
export interface Session {
  access_token: string;
  expires_at: number;
  patient: string;
  // null when the launch carried no encounter. Writes need it.
  encounter: string | null;
  fhir_base_url: string;
  token_endpoint: string;
  scope: string;
  fhirUser: string;
}

// Saved in sessionStorage under "vc_launch_<state>" between the redirect to
// Epic and the redirect back. Section 4 of the spec.
export interface LaunchEntry {
  code_verifier: string;
  iss: string;
  authorization_endpoint: string;
  token_endpoint: string;
  client_id: string;
  launch: string;
}

// Which part of the app made a request. The FHIR panel groups rows by this.
export type RequestSection =
  | "discovery"
  | "token"
  | "patient"
  | "encounter"
  | "vitals"
  | "medications"
  | "create";

// One entry in the FHIR panel per HTTP request made to Epic. Filled in by the
// same function that calls fetch, so it records what was really sent and
// received. Kept in memory only. The one exception is the discovery entry,
// which oauth.ts carries across the redirect (see DISCOVERY_KEY_PREFIX).
export interface RequestLog {
  section: RequestSection;
  method: "GET" | "POST";
  url: string;
  status: number | "pending" | "network error";
  // Number of resources returned. null where it has no meaning (not a search).
  count: number | null;
  // Headers exactly as sent, including the Authorization header.
  requestHeaders: Record<string, string>;
  // Body exactly as sent. null when the request has no body (every GET).
  requestBody: string | null;
  // Raw response text. null if no response arrived (network failure).
  responseBody: string | null;
  // The Location response header, when Epic sent one (a successful create).
  responseLocation: string | null;
}

// A user-facing error: a one-line message plus optional raw detail that the
// UI shows in a collapsible "Details" block.
export interface AppError {
  message: string;
  detail?: string;
}

// The outcome of loading one section of Screen C. A failed section still
// renders; it just shows its error instead of data.
export type SectionResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

// The encounter has three outcomes: the launch carried none, it loaded, or
// the read failed (the ID is still kept for writes).
export type EncounterState =
  | { kind: "none" }
  | { kind: "loaded"; resource: Encounter }
  | { kind: "failed"; id: string; error: AppError };

export interface ChartData {
  patient: SectionResult<Patient>;
  encounter: EncounterState;
  vitals: SectionResult<Observation[]>;
  medications: SectionResult<MedicationRequest[]>;
}
