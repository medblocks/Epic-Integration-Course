// Comes from .env only. There is no fallback value on purpose.
export const CLIENT_ID = import.meta.env.VITE_EPIC_CLIENT_ID ?? "";

// Epic public sandbox, FHIR R4. Used only to prefill the manual launch form.
// At runtime the FHIR base URL always comes from the `iss` launch parameter.
export const SANDBOX_FHIR_BASE_URL = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";

// Must exactly match the redirect URI and the launch URL registered on fhir.epic.com. No trailing slash.
export const REDIRECT_URI = window.location.origin;

// Requested scopes. Space separated. Do not add or remove any.
// SMART v1 scopes. `.read` covers both read and search. `.write` covers create.
export const SCOPES = [
  "launch",
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/Encounter.read",
  "patient/Observation.read",
  "patient/Observation.write",
  "patient/MedicationRequest.read",
].join(" ");
