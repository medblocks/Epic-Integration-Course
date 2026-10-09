# CareSummary

CareSummary is part 1 of the Epic FHIR course. The [course README](../README.md) covers the other apps, the shared Epic sandbox setup, and the test login.

CareSummary is a patient-facing SMART on FHIR app. The patient connects their Epic MyChart account. The app then reads their record from Epic's FHIR R4 server. It shows a one-page snapshot: who they are, their conditions, medications, recent lab results, and vitals.

The app is frontend only. The browser talks directly to Epic. There is no backend, no proxy, and no OAuth or FHIR client library. The app implements the OAuth 2.0 authorization code flow with PKCE using `fetch` and the Web Crypto API. This keeps every step of the flow visible in the source.

## Build prompt

A single prompt built this app. That prompt is the real deliverable of the video. It is in [PROMPT.md](PROMPT.md). Paste the whole file into a coding agent.

## Setup

### 1. Register the app on fhir.epic.com

You need an account on https://fhir.epic.com first. The [course README](../README.md#before-you-start) explains the account and the general sandbox notes. Then:

1. Sign in at https://fhir.epic.com and create a new app.
2. Set the application audience to **Patients**.
3. Add these FHIR R4 resources: `Patient.Read`, `Condition.Search`, `MedicationRequest.Search`, and `Observation.Search`.
4. Add the SMART scopes `openid` and `fhirUser`.
5. Set the redirect URI to `http://localhost:3000` exactly, with **no trailing slash**.
6. Save the app and copy the **Non-Production Client ID**.

A new client ID can take up to one hour to become active. Until then, Epic returns `invalid_client`.

### 2. Set the client ID

Copy `.env.example` to `.env`. Paste your client ID into it:

```
VITE_EPIC_CLIENT_ID=your-client-id-here
```

Git ignores `.env`. The app has no fallback client ID. This is intentional. If the value is missing, Screen A shows a message and disables both the health system list and the connect button.

### 3. Run the app

```
npm install
npm run dev
```

The dev server runs on `http://localhost:3000`. If that port is in use, the server fails to start. This is set by `strictPort` in `vite.config.ts`. Restart the dev server after you change `.env`.

## Test login

Use one of Epic's sandbox test patients. The [course README](../README.md#test-login) has the credentials and the link to Epic's current list.

## How it works

1. **Screen A (Connect)**: Select a health system. Click "Connect your health records". The app generates a PKCE code verifier and challenge. It saves them in `sessionStorage`. It then redirects the whole window to Epic's authorize endpoint.
2. Epic shows the MyChart login and consent screen. Epic then redirects back to `http://localhost:3000?code=...&state=...`.
3. **Screen B (Loading)**: The app checks `state` and clears the query string. It exchanges the code for an access token. It then requests Patient, Condition, MedicationRequest, and Observation (laboratory and vital-signs), one after the other.
4. **Screen C (Summary)**: The app shows the patient banner, four sections, a Debug panel, and a footer with the token expiry time.

### Vitals

The Vitals section shows one tile per vital type. Select a tile to see that vital as a line graph and as a table of every reading.

"View more" at the top right of the section opens the full-page vitals view. This view shows every vital type. It has a date range filter with presets and a custom range. It has a switch between graph view and table view. Blood pressure plots systolic and diastolic together.

The graphs are plain SVG, written by hand. There is no chart library.

Both the section and the full page have a "Debug: vitals requests" block. This block lists the vitals requests and shows how the app grouped the observations.

### Debug panel

The Debug panel lists the token request and every FHIR request. Click a request to see its headers, including the bearer token, and the request and response bodies.

This panel is for learning against the sandbox. Remove the token and the payloads from the panel before you use the app with real patient data.

### Session

The app keeps the session in `sessionStorage` under the key `epic_session`. The session is valid until 30 seconds before `expires_at`. Epic does not issue refresh tokens to public clients. When the token expires, the user reconnects.

## Project layout

- `PROMPT.md`: the full prompt that built the app.
- `src/config.ts`: client ID, Epic endpoints, scopes, and the organisation list.
- `src/oauth.ts`: PKCE generation, the authorize redirect, the token exchange, and session storage.
- `src/fhir.ts`: FHIR requests, pagination, Bundle and OperationOutcome handling, and HTTP error rules.
- `src/mapping.ts`: converts FHIR resources into display values.
- `src/vitals.ts`: groups vital-sign observations by type. Prepares each type for its tile, graph, and table.
- `src/App.tsx`: the single component that decides which screen to show.
- `src/screens/`: Connect, Loading, and Summary.
- `src/components/`: the four sections, the SVG line chart, the full-page vitals view (`VitalsPage.tsx`), the request row that both debug blocks use, the Debug panel, and shared pieces.

## Dependencies

Runtime dependencies: `react` and `react-dom`.

Dev dependencies: `vite`, `typescript`, `@types/react`, and `@types/react-dom`. The two `@types` packages are type declarations only. They ship no code.

There is no Vite React plugin. Vite's built-in esbuild compiles TSX. It uses the `jsx` setting in `tsconfig.json`.

## Known sandbox behaviours

The [course README](../README.md#known-sandbox-behaviours) lists the general sandbox behaviours: the consent screen, the HIPAA warning, empty sections, and the client ID delay. The two behaviours below depend on this app's redirect URI:

- MyChart shows "The request is invalid" (`error=4`) before the login form. Cause: the registered redirect URI does not match `http://localhost:3000`. Check for a trailing slash.
- The token exchange returns `invalid_grant`. There are three possible causes. The redirect URI does not match. The code was already used, for example after a page refresh on the callback. The code verifier does not match the challenge.
