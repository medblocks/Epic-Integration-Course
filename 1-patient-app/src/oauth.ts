// OAuth 2.0 authorization code flow with PKCE, implemented with fetch and the
// Web Crypto API only. No auth library. Section 4 and 5 of the spec.

import { AUTHORIZE_URL, CLIENT_ID, REDIRECT_URI, SCOPES, TOKEN_URL } from "./config";
import type { EpicSession, RequestLog } from "./types";

export const SESSION_KEY = "epic_session";
export const VERIFIER_KEY = "pkce_verifier";
export const STATE_KEY = "oauth_state";
export const BASE_URL_KEY = "fhir_base_url";

// RFC 7636 base64url: standard base64, then + -> -, / -> _, strip = padding.
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Reverse of base64url for decoding the ID token payload.
function base64urlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface Organization {
  id: string;
  name: string;
  fhirBaseUrl: string;
}

// Step 1-6 of the connect flow. Ends by navigating the whole window to Epic.
export async function beginConnect(org: Organization): Promise<void> {
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64url(new Uint8Array(digest));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));

  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(BASE_URL_KEY, org.fhirBaseUrl);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    aud: org.fhirBaseUrl,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

export class TokenExchangeError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Token exchange failed with HTTP ${status}`);
  }
}

export class NetworkError extends Error {
  constructor() {
    super("Could not reach Epic. Check your connection and try again.");
  }
}

// Decode only the payload segment of a JWT. No signature verification: the
// value is used for display in the debug panel, nothing depends on it.
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

// Section 5: exchange the authorization code for a token and save the session.
// The request and response are appended to `log` for the debug panel.
export async function exchangeCode(code: string, log: RequestLog[]): Promise<EpicSession> {
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY) ?? "";
  const fhirBaseUrl = sessionStorage.getItem(BASE_URL_KEY) ?? "";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const entry: RequestLog = {
    section: "token",
    method: "POST",
    url: TOKEN_URL,
    status: "network error",
    count: null,
    requestHeaders: headers,
    requestBody: body.toString(),
    responseBody: null,
  };
  log.push(entry);

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, { method: "POST", headers, body });
  } catch {
    throw new NetworkError();
  }

  entry.status = response.status;
  const text = await response.text();
  entry.responseBody = text;
  if (response.status !== 200) {
    throw new TokenExchangeError(response.status, text);
  }

  const json = JSON.parse(text) as {
    access_token?: string;
    expires_in?: number;
    patient?: string;
    id_token?: string;
    scope?: string;
  };

  const idToken = decodeJwtPayload(json.id_token);

  const session: EpicSession = {
    access_token: json.access_token ?? "",
    expires_at: Date.now() + (json.expires_in ?? 0) * 1000,
    patient: json.patient ?? "",
    fhir_base_url: fhirBaseUrl,
    scope: json.scope ?? "",
    fhirUser: typeof idToken.fhirUser === "string" ? idToken.fhirUser : "",
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return session;
}

export function loadSession(): EpicSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EpicSession;
  } catch {
    return null;
  }
}

// A session is valid if expires_at is more than 30 seconds in the future.
export function isSessionValid(session: EpicSession | null): session is EpicSession {
  return !!session && typeof session.expires_at === "number" && session.expires_at > Date.now() + 30000;
}

export function clearSession(): void {
  sessionStorage.clear();
}
