// SMART EHR launch with OAuth 2.0 authorization code and PKCE, implemented
// with fetch and the Web Crypto API only. Sections 4 and 5 of the spec.

import { REDIRECT_URI, SCOPES } from "./config";
import { epicFetch, NetworkError, parseJson } from "./http";
import { logRequest } from "./log";
import type { AppError, LaunchEntry, RequestLog, Session } from "./types";

export const SESSION_KEY = "vc_session";
export const LAUNCH_KEY_PREFIX = "vc_launch_";
// The discovery request happens before the redirect to Epic, which is a full
// page navigation that empties the in-memory request log. The FHIR panel must
// still show the Discovery row after the redirect (acceptance test 6), so
// that one log entry is carried across under this key and deleted on the
// callback. It holds only the public endpoint URLs: no token, no patient data.
export const DISCOVERY_KEY_PREFIX = "vc_discovery_";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Launch the app again from Epic.";
export const NO_CLIENT_ID_MESSAGE =
  "No client ID is configured. Set VITE_EPIC_CLIENT_ID in .env and restart the dev server, or paste a client ID below.";

// A failure in the launch flow. `detail` is raw text for a "Details" block.
export class LaunchError extends Error {
  constructor(
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

export function launchErrorToAppError(error: unknown): AppError {
  if (error instanceof LaunchError) return { message: error.message, detail: error.detail };
  if (error instanceof NetworkError) return { message: error.message };
  return { message: error instanceof Error ? error.message : "Unexpected error." };
}

// RFC 7636 base64url: standard base64, then + -> -, / -> _, strip = padding.
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Reverse of base64url, for decoding the ID token payload.
function base64urlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Decode only the payload segment of a JWT. No signature verification: the
// value is shown in the FHIR panel and nothing in the app depends on it.
function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> {
  if (!jwt) return {};
  const parts = jwt.split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(base64urlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------- Before the redirect ----------

// iss must use https. A trailing slash is trimmed. The result is the FHIR
// base URL for the whole session. It is not allowlisted here; a real app
// would compare it to the list of hospitals where it is installed.
export function normaliseIss(raw: string): string {
  const iss = raw.trim();
  if (!iss.startsWith("https://")) {
    throw new LaunchError("The FHIR base URL must use https.");
  }
  return iss.replace(/\/+$/, "");
}

export interface SmartEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  // The panel entry for the discovery request, carried across the redirect.
  logEntry: RequestLog;
}

// GET {iss}/.well-known/smart-configuration with Accept: application/json
// and no Authorization header. Logged under the "discovery" section.
export async function discoverEndpoints(iss: string): Promise<SmartEndpoints> {
  const failure = (detail?: string) =>
    new LaunchError(`Could not discover Epic's OAuth endpoints from ${iss}.`, detail);

  const url = `${iss}/.well-known/smart-configuration`;
  const headers = { Accept: "application/json" };
  let response;
  try {
    response = await epicFetch({ section: "discovery", method: "GET", url, headers });
  } catch (error) {
    if (error instanceof NetworkError) throw failure(error.message);
    throw error;
  }

  if (response.status !== 200) {
    throw failure(`HTTP ${response.status}\n${response.text}`);
  }
  const json = parseJson(response.text) as Partial<SmartEndpoints> | null;
  if (
    !json ||
    typeof json.authorization_endpoint !== "string" ||
    typeof json.token_endpoint !== "string"
  ) {
    throw failure(response.text);
  }
  return {
    authorization_endpoint: json.authorization_endpoint,
    token_endpoint: json.token_endpoint,
    logEntry: response.entry,
  };
}

// Generates the PKCE pair and state, saves the launch entry under a key that
// includes the state, and navigates the whole window to Epic's authorize
// endpoint. No popup and no iframe.
export async function redirectToEpic(params: {
  iss: string;
  launch: string;
  clientId: string;
  endpoints: SmartEndpoints;
}): Promise<void> {
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64url(new Uint8Array(digest));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));

  // Keyed by state on purpose. Hyperspace can open the app for two patients
  // in two windows that share storage; a fixed key would let one window
  // overwrite the other's verifier.
  const entry: LaunchEntry = {
    code_verifier: codeVerifier,
    iss: params.iss,
    authorization_endpoint: params.endpoints.authorization_endpoint,
    token_endpoint: params.endpoints.token_endpoint,
    client_id: params.clientId,
    launch: params.launch,
  };
  sessionStorage.setItem(LAUNCH_KEY_PREFIX + state, JSON.stringify(entry));
  sessionStorage.setItem(DISCOVERY_KEY_PREFIX + state, JSON.stringify(params.endpoints.logEntry));

  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    // Epic has required aud since May 2023. Without it the request fails.
    aud: params.iss,
    // The launch token is opaque. It is passed through exactly as received
    // and never decoded.
    launch: params.launch,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`${params.endpoints.authorization_endpoint}?${query.toString()}`);
}

// ---------- After the redirect ----------

export function readLaunchEntry(state: string): LaunchEntry | null {
  const raw = sessionStorage.getItem(LAUNCH_KEY_PREFIX + state);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LaunchEntry;
  } catch {
    return null;
  }
}

export function deleteLaunchEntry(state: string): void {
  sessionStorage.removeItem(LAUNCH_KEY_PREFIX + state);
}

// Puts the discovery request made before the redirect back into the panel's
// log, then forgets it. Only ever called once per callback.
export function restoreDiscoveryLog(state: string): void {
  const key = DISCOVERY_KEY_PREFIX + state;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return;
  try {
    logRequest(JSON.parse(raw) as RequestLog);
  } catch {
    // A corrupt entry only costs the panel one row.
  }
}

export class TokenExchangeError extends LaunchError {
  constructor(status: number, body: string) {
    super(`Token exchange failed with HTTP ${status}.`, body);
  }
}

// Section 5: exchange the code for a token and save the session. The body is
// form-encoded. No Authorization header, no client_secret, no Accept header:
// this is a public client and Content-Type is the only header needed.
export async function exchangeCode(code: string, entry: LaunchEntry): Promise<Session> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: entry.client_id,
    code_verifier: entry.code_verifier,
  }).toString();

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const response = await epicFetch({
    section: "token",
    method: "POST",
    url: entry.token_endpoint,
    headers,
    body,
  });

  if (response.status !== 200) {
    throw new TokenExchangeError(response.status, response.text);
  }

  const json = (parseJson(response.text) ?? {}) as {
    access_token?: string;
    expires_in?: number;
    patient?: string;
    encounter?: string;
    id_token?: string;
    scope?: string;
  };
  if (!json.access_token) {
    throw new LaunchError("The token response did not contain an access_token.", response.text);
  }

  const idToken = decodeJwtPayload(json.id_token);

  const session: Session = {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in ?? 0) * 1000,
    patient: json.patient ?? "",
    encounter: json.encounter ?? null,
    fhir_base_url: entry.iss,
    token_endpoint: entry.token_endpoint,
    scope: json.scope ?? "",
    fhirUser: typeof idToken.fhirUser === "string" ? idToken.fhirUser : "",
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

// ---------- Session ----------

export function loadSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

// A session is valid if expires_at is more than 30 seconds in the future.
export function isSessionValid(session: Session | null): session is Session {
  return (
    !!session &&
    typeof session.expires_at === "number" &&
    session.expires_at > Date.now() + 30000
  );
}

export function clearSession(): void {
  sessionStorage.clear();
}
