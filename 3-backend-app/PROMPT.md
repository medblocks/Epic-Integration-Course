# VitalWatch build prompt

This is the exact prompt VitalWatch was built from. Paste it whole into a coding agent to build the app yourself. The prompt asks for your Epic client ID before it writes any code, so register the app on fhir.epic.com first (see the [README](README.md)).

---

Build a command-line app called **VitalWatch**. It is a backend service for Epic. No user logs in and no browser is involved. The script proves its identity to Epic with a signed JWT, receives an access token, reads vital signs for a set of patients from Epic's FHIR server, compares the latest readings against thresholds, and writes one HTML report that lists the patients whose vitals are abnormal.

### Features

- Backend authentication. The script builds a JWT, signs it with its RSA private key, and exchanges it for an access token with the OAuth 2.0 client credentials grant. There is no authorization code, no redirect and no refresh token.
- Lookup mode (default). The script reads a configured list of patient IDs and fetches each patient and their vital signs, one patient at a time.
- Bulk mode (`--bulk`). The script starts a FHIR Bulk Data export for a group, polls the status URL until the export is ready, downloads the NDJSON files, and reads the same data from them. No list of patient IDs is needed.
- Threshold checks for blood pressure, heart rate and oxygen saturation, using the latest reading of each.
- One self-contained `report.html`: flagged patients at the top, all-clear patients below, and the time of the run.
- A readable log of every step, so the flow can be followed in the terminal.
- Two small helper scripts that turn the private key into a JWK Set and serve it, because Epic fetches the public key from a URL.

This prompt is a specification. Follow it exactly. Where it says "do not", do not. Where a value is given, use that value. Do not substitute libraries, endpoints, or flows you think are equivalent. If something is ambiguous, pick the simplest option that satisfies the spec and leave a code comment explaining the choice.

### 1. Architecture (non-negotiable)

- A Node.js script. No web server, no frontend, no database, no scheduler. One run does one check and exits.
- Plain JavaScript with ES modules (`"type": "module"`). No TypeScript and no build step.
- Node 20 or newer. Use the built-in `fetch` and `node:crypto`.
- No OAuth, JWT, FHIR, HTTP or dotenv libraries for the app (do not use `jsonwebtoken`, `jose`, `fhirclient`, `axios`, `dotenv`, or similar). Sign the JWT with `node:crypto`. The point of this app is to see every step.
- The only dependencies in `package.json` are `express` and `node-jose`, and only the two files in `scripts/` may import them. Nothing in `src/` imports a package.
- Project layout, exactly these files:

```
.env.example
package.json
README.md
scripts/2b_keys_from_pem.js
scripts/3_serve_keys.js
src/index.js
src/config.js
src/auth.js
src/fetch-lookup.js
src/fetch-bulk.js
src/check.js
src/report.js
```

- `package.json` scripts: `"start": "node src/index.js"` and `"bulk": "node src/index.js --bulk"`. Set `"engines": { "node": ">=20" }`.
- The app never generates, prints, copies or uploads the private key. It only reads it to sign.

### 2. Configuration

Before writing any code, ask me for my Epic client ID. I registered a Backend Systems app on fhir.epic.com and have the non-production ID. Do not start building until you have it, do not invent one, and do not hardcode any client ID in the source. Put the value I give you in `.env` as `EPIC_CLIENT_ID`.

Create `.env.example` with exactly this content:

```
EPIC_FHIR_BASE_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
EPIC_CLIENT_ID=
PRIVATE_KEY_PATH=./privatekey.pem
```

Create `.env` with the same three lines and my client ID filled in. Do not commit `.env`.

`src/config.js` reads `.env` itself: read the file from the project root (the folder that holds `package.json`, found from `import.meta.url`, not from the current working directory), split it into lines, skip blank lines and lines starting with `#`, split each line on the first `=`, trim, and strip one pair of surrounding quotes. Values already set in `process.env` win.

`src/config.js` exports:

```js
export const FHIR_BASE_URL;     // EPIC_FHIR_BASE_URL with any trailing slash removed
export const CLIENT_ID;         // EPIC_CLIENT_ID
export const PRIVATE_KEY_PATH;  // absolute path. A relative value resolves against the project root.
export const REPORT_PATH;       // <project root>/report.html

// Epic sandbox test patients. Lookup mode reads these one at a time.
export const PATIENT_IDS = [
  "erXuFYUfucBZaryVksYEcMg3", // Camila Lopez
  "eq081-VQEgP8drUUqCWzHfw3", // Derrick Lin
  "eAB3mDIBBcyUKviyzrxsnAw3", // Desiree Powell
  "egqBHVfQlt4Bw3XGXoxVxHg3", // Elijah Davis
  "eIXesllypH3M9tAA5WdJftQ3", // Linda Ross
  "eh2xYHuzl9nkSFVvV3osUHg3", // Olivia Roberts
  "e0w0LEDCYtfckT6N.CkJKCw3", // Warren McGinnis
];

// The only group in the Epic sandbox. Bulk mode exports it.
export const BULK_GROUP_ID = "e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83";

// A reading is abnormal when it is below `low` or above `high`.
export const THRESHOLDS = {
  systolic:  { label: "Systolic blood pressure",  unit: "mmHg", low: 90, high: 140 },
  diastolic: { label: "Diastolic blood pressure", unit: "mmHg", low: 60, high: 90 },
  heartRate: { label: "Heart rate",               unit: "/min", low: 50, high: 100 },
  oxygen:    { label: "Oxygen saturation",        unit: "%",    low: 92 },
};

// Bulk polling, in seconds.
export const BULK_POLL_SECONDS = 10;
export const BULK_TIMEOUT_SECONDS = 1200;
```

Configuration errors stop the run with exit code 1 and one clear line each:

- No `.env` file: `No .env file found. Copy .env.example to .env and set EPIC_CLIENT_ID.`
- Empty client ID: `EPIC_CLIENT_ID is empty. Set it in .env.`
- Key file missing: `Private key not found at <absolute path>. Set PRIVATE_KEY_PATH in .env.`

### 3. Command line

- `npm start` runs lookup mode.
- Bulk mode runs when `process.argv` contains `--bulk` or when `process.env.npm_config_bulk` is `"true"`. This makes `npm start -- --bulk`, `npm start --bulk` and `npm run bulk` all work.
- Any other argument prints `Usage: npm start [-- --bulk]` and exits 1.

`src/index.js` is the only file that decides the mode. Its whole job is: load config, get a token, call one fetcher, run the checks, write the report, print a summary, exit.

### 4. Authentication (`src/auth.js`)

Step 1, discovery. `GET {FHIR_BASE_URL}/.well-known/smart-configuration` with `Accept: application/json`. Read `token_endpoint`. Do not hardcode the token URL.

Step 2, build the JWT.

Header:

```json
{ "alg": "RS384", "typ": "JWT", "kid": "<kid>" }
```

`kid` is the RFC 7638 thumbprint of the public key: take the public key from the private key with `crypto.createPublicKey`, export it as a JWK, build the string `{"e":"<e>","kty":"RSA","n":"<n>"}` with the keys in exactly that order and no spaces, SHA-256 it, and base64url-encode the digest. This equals the `kid` that `scripts/2b_keys_from_pem.js` prints.

Payload:

```json
{
  "iss": "<CLIENT_ID>",
  "sub": "<CLIENT_ID>",
  "aud": "<token_endpoint>",
  "jti": "<crypto.randomUUID()>",
  "exp": <now in seconds + 300>
}
```

`exp` is a number. 300 seconds is the maximum Epic accepts. Build a new JWT, with a new `jti`, for every token request.

Sign `base64url(header) + "." + base64url(payload)` with `crypto.createSign("RSA-SHA384")` and the private key. The JWT is the three base64url parts joined with dots. Base64url means no padding.

Step 3, token request:

```
POST <token_endpoint>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<the JWT>
```

The response has `access_token`, `token_type`, `expires_in` and `scope`. There is no refresh token and no `patient` field. Keep the token in memory only.

`auth.js` exports:

- `getAccessToken()`: returns a valid token. It reuses the one in memory until 60 seconds before it expires, then repeats steps 2 and 3.
- `epicFetch(url, options)`: adds `Authorization: Bearer <token>`, calls `fetch`, and on a `401` gets a new token and retries once.

If the token request fails, print the status and Epic's `error` and `error_description`, then print this hint and exit 1:

```
Check: the JWKS URL is reachable (JWKS server and ngrok running), the URL is saved on the app in fhir.epic.com, the client ID is the non-production one, and the app was registered more than a few hours ago.
```

Never print the private key or the JWT. Never print the whole access token: log only its first 8 characters.

### 5. Lookup mode (`src/fetch-lookup.js`)

For each ID in `PATIENT_IDS`, in order and one at a time:

1. `GET {FHIR_BASE_URL}/Patient/{id}` with `Accept: application/fhir+json`.
2. `GET {FHIR_BASE_URL}/Observation?patient={id}&category=vital-signs` with `Accept: application/fhir+json`. Collect `entry[].resource` where `resourceType` is `Observation`. While the Bundle has a `link` with `relation` `next`, fetch that URL exactly as given, up to 10 pages.

Skip entries whose resource is an `OperationOutcome`. If a request for one patient fails, record the error message for that patient and continue with the next one. Do not stop the run.

Export `fetchLookup()`. It returns an array of `{ patient, observations, error }`: `patient` is the FHIR Patient resource or `{ id }` when it could not be read, `observations` is an array, `error` is a string or `null`.

### 6. Bulk mode (`src/fetch-bulk.js`)

Step 1, kickoff:

```
GET {FHIR_BASE_URL}/Group/{BULK_GROUP_ID}/$export?_type=Patient,Observation
Accept: application/fhir+json
Prefer: respond-async
```

Expect `202 Accepted`. Read the status URL from the `Content-Location` response header and use it exactly as given. It is not under `FHIR_BASE_URL`. Any other status: print the status and body and exit 1.

Step 2, poll the status URL with `GET` and `Accept: application/json`:

- `202`: still running. Log the `X-Progress` header when present. Wait, then poll again. The wait is the `Retry-After` header in seconds when present and numeric, otherwise `BULK_POLL_SECONDS`. Never wait less than 5 seconds.
- `429`: Epic is throttling. Wait `Retry-After` seconds, or 30 seconds when the header is missing, then poll again.
- `200`: done. The JSON body has `output`, an array of `{ type, url }`.
- Anything else: print the status and body and exit 1.
- Stop with an error after `BULK_TIMEOUT_SECONDS`.

Step 3, download. For each `output` entry whose `type` is `Patient` or `Observation`, `GET` its `url` with the bearer token and `Accept: application/fhir+ndjson`. The file is NDJSON: one JSON resource per line. Split on newlines, skip empty lines, parse each line. A type can have more than one file.

Step 4, shape the data. Keep only Observations that have a `category` coding with code `vital-signs`. Group them by patient using `subject.reference`, taking the part after `Patient/`. Return one entry per Patient resource. Log the totals.

Step 5, clean up. Send `DELETE` to the status URL. Log the result. A failure here is not an error.

Export `fetchBulk()`. It returns the same array shape as `fetchLookup()`.

### 7. Checks (`src/check.js`)

Ignore an Observation when `status` is `entered-in-error` or `cancelled`, or when it has no numeric value. The date of a reading is `effectiveDateTime`, else `effectivePeriod.start`, else `issued`.

Match readings by LOINC code (`system` `http://loinc.org`) anywhere in `code.coding`:

| Vital | Where the number is |
|---|---|
| Systolic | `component` with code `8480-6` inside a `85354-9` panel, or an Observation coded `8480-6` |
| Diastolic | `component` with code `8462-4` inside a `85354-9` panel, or an Observation coded `8462-4` |
| Heart rate | Observation coded `8867-4`, `valueQuantity.value` |
| Oxygen saturation | Observation coded `2708-6` or `59408-5`, `valueQuantity.value` |

For each patient, take the latest reading of each of the four. A reading is abnormal when it is below `low` or above `high` in `THRESHOLDS`. A vital with no reading is not abnormal.

Export `checkPatients(results)`. It returns, per patient:

```js
{
  id, name, birthDate, gender,
  error,                 // string or null
  readings: {            // each is null or { value, unit, date, abnormal, reason }
    systolic, diastolic, heartRate, oxygen
  },
  flagged                // true when any reading is abnormal
}
```

`name` is the first `official` name, else the first name, as given names then family; `Unknown patient` when there is none. `reason` reads like `Systolic blood pressure 152 mmHg is above 140`.

### 8. Report (`src/report.js`)

Write `report.html` to `REPORT_PATH`, replacing any earlier file. One self-contained HTML file: inline CSS, no JavaScript, no external fonts, images or stylesheets. It must print cleanly.

Content, in this order:

1. Title `VitalWatch`, then one line: `Run on <date and time of the run> · <Lookup mode | Bulk mode> · <n> patients checked · <n> flagged`.
2. Section **Flagged**. One card per flagged patient, sorted by name: name, date of birth and sex, then a table with a row for blood pressure, heart rate and oxygen saturation showing the latest value, its date, and the reason when abnormal. Abnormal rows are visibly marked. Blood pressure is one row, `systolic/diastolic mmHg`, and is abnormal when either number is. When nobody is flagged, show `No patients flagged.`
3. Section **All clear**. One table, sorted by name: patient, blood pressure, heart rate, oxygen saturation, date of the latest reading. A missing reading shows `No reading`.
4. Section **Not checked**, only when at least one patient has an `error`: patient ID and the error.
5. A footer line with the thresholds that were used.

Escape every value from Epic before putting it in the HTML. Dates show as `23 Nov 2026`.

Export `writeReport(patients, { mode, startedAt })`.

### 9. Logging

Print one line per step to the terminal, in this order and with these prefixes:

```
VitalWatch, lookup mode
[auth]   Token endpoint: https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
[auth]   Requesting access token... 200 OK, expires in 3600s
[lookup] 7 patients configured
[lookup] Camila Maria Lopez: 259 vital-sign observations
...
[check]  2 flagged, 5 all clear
[report] Written to report.html
```

```
VitalWatch, bulk mode
[auth]   Token endpoint: ...
[auth]   Requesting access token... 200 OK, expires in 3600s
[bulk]   Kickoff: 202 Accepted
[bulk]   Status: 202, Processing - patient data, 85% complete. Checking again in 10s
[bulk]   Status: 200, export ready: 8 files
[bulk]   Downloading Observation (1 of 8)
[bulk]   Downloading Patient (2 of 8)
...
[bulk]   Downloads complete: 7 patients, 2595 vital-sign observations
[bulk]   Export deleted
[check]  2 flagged, 5 all clear
[report] Written to report.html
```

The numbers are examples. Print the real ones. The text after `Status: 202,` is the `X-Progress` header exactly as Epic sent it, or `in progress` when the header is missing. A failed patient in lookup mode logs `[lookup] <id>: failed, <error>`, and the `[check]` line then ends with `, <n> not checked`.

### 10. Key helper scripts

Create these two files exactly. They are run by hand before the app, not by the app.

`scripts/2b_keys_from_pem.js`:

```js
import jose from 'node-jose'
import fs from 'fs'

// Builds keys.json from an existing PEM private key (README step 1)
// Usage: node scripts/2b_keys_from_pem.js [path/to/privatekey.pem]
const pemPath = process.argv[2] ?? new URL('../privatekey.pem', import.meta.url)
const outPath = new URL('keys.json', import.meta.url)

const keyStore = jose.JWK.createKeyStore()
const key = await keyStore.add(fs.readFileSync(pemPath), 'pem', { alg: 'RS384', use: 'sig' })

fs.writeFileSync(outPath, JSON.stringify(keyStore.toJSON(true), null, '  '))
console.log(`keys.json written. kid: ${key.kid}`)
```

`scripts/3_serve_keys.js`:

```js
import express from 'express'
import fs from 'fs'
import jose from 'node-jose'

const app = express()

app.get('/jwks', async (req, res) => {
  const ks = fs.readFileSync(new URL('keys.json', import.meta.url))
  const keyStore = await jose.JWK.asKeyStore(ks.toString())
  res.json(keyStore.toJSON())
})

app.get('/', async (req, res) => {
  res.send('Hello World!')
})

app.listen(3000,()=>{
  console.log("Listening on port 3000. Please point the JWKS URI to http://localhost:3000/jwks")
})
```

### 11. Error handling

- A network failure prints the URL and the error, then exits 1. Exception: in lookup mode a failure for one patient is recorded and the run continues.
- When Epic returns an `OperationOutcome`, print `issue[0].diagnostics`, else `issue[0].details.text`.
- A `403` on a FHIR request prints: `Epic refused this request. Check that the API is selected on the app in fhir.epic.com.`
- Never write fake, sample or cached data into the report. If nothing could be read, exit 1 and write no report.

### 12. Things that must not happen

- Do not start a web server or open a browser from `src/`.
- Do not generate a key pair, and do not run `openssl` for me.
- Do not put the client ID, the private key or a token in source code, in the report or in the log.
- Do not add a refresh token flow. A backend app asks for a new token with a new JWT.
- Do not reuse a JWT or a `jti`.
- Do not hardcode the token URL or the bulk status URL.
- Do not poll the status URL faster than every 5 seconds.
- Do not fetch patients in parallel in lookup mode.
- Do not add vitals or thresholds beyond the three in section 2.
- Do not add email, PDF, scheduling or a database.
- Do not add dependencies.

### 13. Deliverables

- Full source in a runnable state.
- `README.md` with:
  - Part 1, the keys: create the private key with `openssl genrsa -out ./privatekey.pem 2048`, run `node scripts/2b_keys_from_pem.js`, run `node scripts/3_serve_keys.js`, expose port 3000 with ngrok, and paste `https://<your-ngrok-domain>/jwks` into the Non-Production JWK Set URL field of the app on fhir.epic.com.
  - What to register on fhir.epic.com: application audience "Backend Systems"; `Patient.Read (R4)`, `Observation.Search (Vitals) (R4)`, and the Bulk Data APIs (Kick-off, Status Request, File Request, Delete Request); no redirect URI.
  - Part 2, running VitalWatch: copy `.env.example` to `.env`, set `EPIC_CLIENT_ID`, keep the JWKS server and ngrok running, then `npm install`, `npm start`, and `npm start -- --bulk`. Say that `report.html` is written to the project folder.
  - A note that a newly registered or edited app can take hours to work and returns `invalid_client` until then.
  - A note that `privatekey.pem`, `scripts/keys.json` and `.env` must never be committed.

### 14. Acceptance test

Run these in order:

1. With no `.env`, `npm start` prints the "No .env file found" line and exits 1.
2. With `PRIVATE_KEY_PATH` pointing at a missing file, `npm start` prints the "Private key not found" line with the absolute path and exits 1.
3. The `kid` computed in `auth.js` equals the `kid` printed by `node scripts/2b_keys_from_pem.js`.
4. `npm start` prints the lookup log in the order of section 9 and writes `report.html`.
5. `report.html` opens from the file system with no network requests, shows the run time, lists flagged patients before all-clear patients, and marks each abnormal reading with its reason.
6. `npm start -- --bulk`, `npm start --bulk` and `npm run bulk` each run bulk mode: a `202` kickoff, at least one status line, the downloads, then the report.
7. The bulk report lists the same patients with the same flags as the lookup report.
8. With one invalid ID added to `PATIENT_IDS`, the lookup run finishes and that ID appears under "Not checked".
9. No file in `src/` imports a package, and the log contains no full token.

If Epic answers `invalid_client` at step 4, say so and stop. Do not fake the remaining steps. Do not mark the task complete until all 9 pass.

### 15. Known sandbox behaviours (do not "fix" these)

- A new or edited app can return `invalid_client` for several hours.
- Epic fetches the JWK Set URL itself. If the JWKS server or ngrok is stopped, token requests fail with `invalid_client`.
- The bulk status URL has a different base URL from the FHIR server.
- A bulk export of seven patients can take longer than seven lookups. The status can stay `202` for a minute or more, and the status body can be empty until the `200`.
- `X-Progress` is Epic's own header. It is not part of the FHIR Bulk Data specification, and its wording changes between stages of the export.
- The export comes back as several files per resource type, in no fixed order.
- `npm start --bulk` prints an npm warning about an unknown config. It still works. `npm start -- --bulk` has no warning.
- Some test patients have no vital signs at all, and some have no oxygen saturation reading.
- Polling too often returns `429`.
- Epic can refuse a new kickoff while an earlier export of the same group is still active. Deleting the earlier export through its status URL clears it.
- The sandbox data is old. Dates in the report are years in the past.
