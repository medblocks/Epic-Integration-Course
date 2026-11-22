import crypto from "node:crypto";
import fs from "node:fs";
import { CLIENT_ID, FHIR_BASE_URL, PRIVATE_KEY_PATH } from "./config.js";

const HINT =
  "Check: the JWKS URL is reachable (JWKS server and ngrok running), the URL is saved on the app in fhir.epic.com, " +
  "the client ID is the non-production one, and the app was registered more than a few hours ago.";

let tokenEndpoint = null;
let cached = null; // { accessToken, expiresAt }

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function privateKey() {
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));
}

// RFC 7638 thumbprint of the public key. scripts/2b_keys_from_pem.js prints the same value.
export function keyId() {
  const jwk = crypto.createPublicKey(privateKey()).export({ format: "jwk" });
  const canonical = `{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`;
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

// A network failure prints the URL and the error, then stops the run.
export async function plainFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    console.error(`Request failed: ${url}`);
    console.error(err.cause?.message ?? err.message);
    process.exit(1);
  }
}

// Step 1: discovery. The token URL is read from the server, never hardcoded.
async function discoverTokenEndpoint() {
  if (tokenEndpoint) return tokenEndpoint;
  const url = `${FHIR_BASE_URL}/.well-known/smart-configuration`;
  const res = await plainFetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.error(`Discovery failed: ${res.status} ${res.statusText} from ${url}`);
    process.exit(1);
  }
  tokenEndpoint = (await res.json()).token_endpoint;
  console.log(`[auth]   Token endpoint: ${tokenEndpoint}`);
  return tokenEndpoint;
}

// Step 2: a new JWT, with a new jti, for every token request.
function buildJwt(audience) {
  const header = { alg: "RS384", typ: "JWT", kid: keyId() };
  const payload = {
    iss: CLIENT_ID,
    sub: CLIENT_ID,
    aud: audience,
    jti: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 300, // 300 seconds is the maximum Epic accepts
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign("RSA-SHA384").update(signingInput).sign(privateKey()).toString("base64url");
  return `${signingInput}.${signature}`;
}

// Step 3: exchange the JWT for an access token.
async function requestToken() {
  const endpoint = await discoverTokenEndpoint();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: buildJwt(endpoint),
  });
  const res = await plainFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON. The raw text is printed below.
  }
  if (!res.ok || !json.access_token) {
    console.error(`[auth]   Requesting access token... ${res.status} ${res.statusText}`);
    console.error(`[auth]   ${json.error ?? "no error code"}: ${json.error_description ?? text.slice(0, 300)}`);
    console.error(HINT);
    process.exit(1);
  }
  // The token itself is never printed.
  console.log(`[auth]   Requesting access token... ${res.status} OK, expires in ${json.expires_in}s`);
  cached = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.accessToken;
}

// Returns a valid token. The one in memory is reused until 60 seconds before it expires.
export async function getAccessToken() {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.accessToken;
  return requestToken();
}

// fetch with the bearer token. On a 401 it gets a new token and retries once.
export async function epicFetch(url, options = {}) {
  const send = async () =>
    plainFetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${await getAccessToken()}` },
    });
  let res = await send();
  if (res.status === 401) {
    cached = null;
    res = await send();
  }
  return res;
}

// Turns a failed FHIR response into one readable line.
export async function describeFailure(res) {
  if (res.status === 403) {
    return "Epic refused this request. Check that the API is selected on the app in fhir.epic.com.";
  }
  const text = await res.text();
  try {
    const issue = JSON.parse(text).issue?.[0];
    const detail = issue?.diagnostics ?? issue?.details?.text;
    if (detail) return `${res.status} ${res.statusText}: ${detail}`;
  } catch {
    // Not an OperationOutcome.
  }
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`;
}
