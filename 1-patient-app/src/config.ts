// Comes from .env only. There is no fallback value on purpose.
export const CLIENT_ID = import.meta.env.VITE_EPIC_CLIENT_ID ?? "";

// Epic public sandbox, FHIR R4. These are fixed. Do not change them.
export const FHIR_BASE_URL = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";
export const AUTHORIZE_URL = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize";
export const TOKEN_URL = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token";

// Must exactly match a redirect URI registered on fhir.epic.com. No trailing slash.
export const REDIRECT_URI = window.location.origin +"/";

// Requested scopes. Space separated. Do not add or remove any.
export const SCOPES = [
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/Condition.read",
  "patient/MedicationRequest.read",
  "patient/Observation.read",
].join(" ");

// Health systems the patient can pick from. The sandbox is a single org.
export const ORGANIZATIONS = [
  { id: "epic-sandbox", name: "Epic Sandbox (test data)", fhirBaseUrl: FHIR_BASE_URL },
];
