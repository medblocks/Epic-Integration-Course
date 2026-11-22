# VitalWatch

Part 3 of the [Epic FHIR course](../README.md). VitalWatch is a backend service. No user logs in. The script proves its identity to Epic with a signed JWT, gets an access token, reads vital signs for a set of patients, and writes `report.html` listing the patients whose latest blood pressure, heart rate or oxygen saturation is outside the thresholds.

The full prompt that built the app is in [PROMPT.md](PROMPT.md).

All commands run from the `3-backend-app` folder. You need Node 20 or newer.

```
npm install
```

## What to register on fhir.epic.com

| Setting | Value |
| --- | --- |
| Application audience | Backend Systems |
| Incoming APIs (R4) | `Patient.Read`, `Observation.Search (Vitals)`, and the Bulk Data APIs: Kick-off, Status Request, File Request, Delete Request |
| Redirect URI | None. There is no browser in this flow. |
| Non-Production JWK Set URL | `https://<your-ngrok-domain>/jwks` (Part 1, step 5) |

A new or edited app can take a few hours, sometimes up to a day, to work. Until then Epic returns `invalid_client`.

## Part 1: keys and your first token by hand

### 1. Create the private key

```
openssl genrsa -out ./privatekey.pem 2048
```

Run this locally. Never use an online key generator, and never share or commit this file.

### 2. Create the public key in JWK Set format

```
node scripts/2b_keys_from_pem.js
```

This writes `scripts/keys.json` and prints a `kid`. Note it down; you need it for the JWT.

### 3. Host the public key

```
node scripts/3_serve_keys.js
```

Open http://localhost:3000/jwks to see your public key.

### 4. Make it public with ngrok

1. Create an ngrok account. Go to Endpoints > Create Endpoint, choose Agent, then Public, tick Allow pooling, and continue.
2. Install ngrok and add your auth token (shown under Setup & Installation):
   ```
   ngrok config add-authtoken <your-token>
   ```
3. In a second terminal:
   ```
   ngrok http 3000 --url https://<your-ngrok-domain> --pooling-enabled
   ```

Open `https://<your-ngrok-domain>/jwks`. It shows the same key, now over HTTPS.

### 5. Register the URL with Epic

In your app on fhir.epic.com, paste `https://<your-ngrok-domain>/jwks` into the Non-Production JWK Set URL field and save.

### 6. Create the JWT on jwt.io (sandbox keys only)

Header:

```
{ "alg": "RS384", "typ": "JWT", "kid": "<kid from step 2>" }
```

Payload:

```
{
  "iss": "<your client ID>",
  "sub": "<your client ID>",
  "aud": "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
  "jti": "<any new random string>",
  "exp": <current Unix time + 300>
}
```

Paste the contents of `privatekey.pem` into the signature section and copy the signed token.

### 7. Get an access token in Postman

`POST https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token`, body `x-www-form-urlencoded`:

| Key | Value |
|---|---|
| grant_type | client_credentials |
| client_assertion_type | urn:ietf:params:oauth:client-assertion-type:jwt-bearer |
| client_assertion | the JWT from step 6 |

### 8. Read patient data

Send these with the header `Authorization: Bearer <access_token>`:

```
GET https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Patient/<patient-id>
GET https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Observation?patient=<patient-id>&category=vital-signs
```

Use Camila Lopez's FHIR ID from Epic's sandbox test patients page.

## Part 2: run VitalWatch

### 1. Set the client ID

```
cp .env.example .env
```

Open `.env` and set `EPIC_CLIENT_ID` to the non-production client ID of your backend app. The sandbox URL is already filled in. `PRIVATE_KEY_PATH` already points at the `privatekey.pem` from Part 1; change it only if your key is somewhere else. A relative path is read from this folder, and an absolute path works too.

### 2. Keep the public key reachable

Epic fetches your public key every time it checks a token. Keep `node scripts/3_serve_keys.js` and ngrok running, on the same URL you registered.

### 3. Run it

```
npm start
```

This is lookup mode. The script requests a token, reads each patient in `PATIENT_IDS` (in `src/config.js`) and their vital signs one at a time, checks them, and writes `report.html` in this folder. Open the file in a browser.

```
npm start -- --bulk
```

This is bulk mode. The script starts a Bulk Data export for the sandbox group, checks the status until the export is ready, downloads the files, and writes the same report. No list of patient IDs is needed. `npm run bulk` does the same.

## How it works

| File | What it does |
| --- | --- |
| `src/index.js` | Picks the mode and runs the pipeline: token, fetch, check, report. |
| `src/config.js` | Reads `.env`. Holds the patient IDs, the group ID and the thresholds. |
| `src/auth.js` | Builds and signs the JWT, and exchanges it for an access token. |
| `src/fetch-lookup.js` | Reads patients and their vitals one at a time. |
| `src/fetch-bulk.js` | Runs the export: kickoff, status polling, download. |
| `src/check.js` | Compares the latest reading of each vital against the thresholds. |
| `src/report.js` | Writes `report.html`. |

To change what counts as abnormal, edit `THRESHOLDS` in `src/config.js`.

The app has no dependencies of its own. `express` and `node-jose` are used only by the two scripts in `scripts/`.

## Known sandbox behaviours

- A new or edited app returns `invalid_client` for several hours.
- If the JWKS server or ngrok is stopped, token requests fail with `invalid_client`.
- The bulk status URL has a different base URL from the FHIR server.
- A bulk export of seven patients can take longer than seven lookups. The status stays `202` until the export is ready.
- Checking the status too often returns `429`. The script waits and tries again.
- Epic can refuse a new export while an earlier one for the same group is still active.
- The sandbox data is old. Dates in the report are years in the past.

## Keep these out of git

`privatekey.pem`, `scripts/keys.json` and `.env` hold secrets. The repository's `.gitignore` covers them. Never commit them and never paste a production key into a website.
