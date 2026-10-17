# VitalCheck

A clinician-facing SMART on FHIR app. A clinician opens it from inside Epic while looking at a patient. Epic launches the app with the patient and the encounter already selected. The app reads the patient's vitals and medications from Epic's FHIR server, shows the vitals as a graph and a table, and lets the clinician add a new vital reading that is written straight back into the patient's chart.

The browser does the whole SMART EHR launch by hand: endpoint discovery from `iss`, OAuth 2.0 authorization code with PKCE, the token exchange, every FHIR read, and the FHIR write. There is no backend, no OAuth library and no FHIR library. A FHIR panel on the chart screen shows every request and response, including the bearer token, so you can see each step.

The prompt that built this app is in [PROMPT.md](PROMPT.md).

## Run it

1. Register the app on fhir.epic.com (see the next section) and copy the **Non-Production Client ID**.
2. Copy `.env.example` to `.env` and put the client ID in it:

   ```
   VITE_EPIC_CLIENT_ID=your-non-production-client-id
   ```

   `.env` is ignored by git. The app reads the client ID from there and from nowhere else. If it is empty, the launch screen says so and you can paste a client ID into the manual launch form instead.

3. Install and start:

   ```
   npm install
   npm run dev
   ```

   The dev server runs on http://localhost:3000 and fails if that port is taken. The port matters: it is part of the redirect URI registered with Epic.

## What to register on fhir.epic.com

Create an app at https://fhir.epic.com/Developer/Apps with these values.

| Setting | Value |
| --- | --- |
| Application audience | Clinicians or Administrative Users |
| FHIR R4 resources | Patient.Read, Encounter.Read, Observation.Read (Vitals), Observation.Search (Vitals), Observation.Create (Vitals), MedicationRequest.Read, MedicationRequest.Search |
| SMART scopes | openid, fhirUser |
| SMART on FHIR version | R4 |
| SMART scope version | v1 |
| Redirect URI | `http://localhost:3000` with no trailing slash |
| Can Register Dynamic Clients | off |
| Is Confidential Client | off |
| Save the app for the sandbox | ticked |

The redirect URI must be exactly `http://localhost:3000`. The app sends `window.location.origin`, which has no trailing slash. A mismatch makes Epic reject the authorize request with `invalid_request`.

A clinician app has no automatic client distribution: each hospital that installs it does so on its own. Scopes cannot be changed after the app is marked ready for production, so register only what the app needs.

A newly registered client ID can take up to 24 hours to work. Until then Epic returns `invalid_client`. If the sandbox box was not ticked on the registration form, the client ID never works in the sandbox.

## Launch it for testing

Epic's launcher simulates a hospital launching the app.

1. Open https://fhir.epic.com, go to **Documentation**, then **Launching your app from Epic**.
2. Click **Try It**.
3. Pick your app and a test patient.
4. Enter `http://localhost:3000` as the launch URL.
5. Click **Launch**.

Epic opens `http://localhost:3000/?iss=...&launch=...`. The app discovers Epic's OAuth endpoints from `iss`, redirects to Epic's authorize endpoint with the launch token, comes back with a code, exchanges it for a token, and loads the chart. There is no login and no consent screen, because the launch token proves a clinician is already signed in.

**Generate URL Only** builds the same launch URL without opening it. Copy the `launch` value out of that URL and paste it into the manual launch form on the app's launch screen, together with the FHIR base URL and your client ID, then click **Launch**. This runs the same flow for the patient chosen in the launcher. Launch tokens are single use, so generate a new one for each attempt.

Epic's hospital-side testing harness, **Testing integrations in Hyperdrive** on fhir.epic.com, lets you open the same app inside a real Hyperspace client. Hyperspace embeds the app in a sidebar, a floating window or an external browser that does not behave like a normal browser, which is why the app works at 390px wide, uses only `sessionStorage`, keys the launch entry by `state`, and never opens a popup or an iframe.

## Deploy to Netlify

The app is static files, so any static host works. For Netlify:

1. Push this repository to GitHub.
2. In Netlify choose **Add new site**, then **Import an existing project**, and pick the repository.
3. Set **Base directory** to `2-practitioner-app`. The build command (`npm run build`) and publish directory (`dist`) are read from [netlify.toml](netlify.toml).
4. Under **Environment variables** add `VITE_EPIC_CLIENT_ID` with your Non-Production Client ID. Vite bakes it into the bundle at build time, so changing it later needs a redeploy.
5. Deploy, then copy the site URL, for example `https://vitalcheck.netlify.app`.
6. On fhir.epic.com edit the app and add that URL as a second redirect URI, with no trailing slash. Keep `http://localhost:3000` for local work. The change can take up to an hour to sync.
7. In Epic's launcher enter the same URL as the launch URL and click Launch.

Deploy previews and branch deploys get their own `*.netlify.app` origins. Epic rejects a redirect URI it does not know, so test launches only against the production URL or add each preview origin to the registration.

## Known sandbox behaviours

These are expected. Do not "fix" them.

- A new client ID can return `invalid_client` for up to 24 hours after registration.
- Epic's launcher sometimes launches without an encounter. The token response then has no `encounter` field. The app shows an amber "Visit: none in this launch" line and disables "Add a reading". That is correct.
- A successful `POST /Observation` returns 201 with an empty body and a `Location` header. The new reading appears after the app re-fetches vitals from Epic, and Epic may take a moment to include it.
- Epic files a vital to a flowsheet row. The sandbox maps standard LOINC codes to rows, so copying the code from an existing reading works. A hospital may use site-specific flowsheet IDs; that is an installation detail. Error codes 59187 to 59189 mean Epic found no matching row or could not file the reading.
- A reading Epic returns carries several codings in `code`: an Epic flowsheet-row ID, an Epic internal code, the vital's LOINC code and the generic "Vital signs" LOINC 8716-3. Sending all of them back fails with error 59102 "Multiple Flowsheet rows found by given codes", because two of them map to different rows. The app therefore sends exactly one coding, preferring Epic's flowsheet-row coding, then the vital's LOINC coding. The FHIR panel's Writes row shows the body that was sent.
- Writing BMI or height can fail at some sites because Epic calculates those itself. The error from Epic is shown.
- Some sandbox patients have empty sections. "Not recorded" is correct there.
- If Epic shows `invalid_request` or a page saying the request is invalid before redirecting back, the redirect URI does not match the registered one. Register exactly `http://localhost:3000`.
- If the token exchange returns `invalid_grant`, the usual causes are: the redirect URI does not match, the code was already used (a refresh after the callback), the code verifier does not match the challenge, or the launch token was already used.

## A note on the FHIR panel

The FHIR panel shows the access token and the raw request and response payloads on purpose, so that every step is visible. That is acceptable only because this app runs against the Epic sandbox with test patients. Remove the token and the payloads from the panel before using this app with real patient data.
