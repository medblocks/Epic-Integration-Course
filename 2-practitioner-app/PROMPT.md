# VitalCheck build prompt

This is the exact prompt VitalCheck was built from. Paste it whole into a coding agent to build the app yourself. The prompt asks for your Epic client ID before it writes any code, so register the app on fhir.epic.com first (see the [README](README.md)).

---

Build a web app called **VitalCheck**. It is a clinician-facing SMART on FHIR app. A clinician opens it from inside Epic while looking at a patient. Epic launches the app with the patient and the encounter already selected. The app reads the patient's vitals and medications from Epic's FHIR server, shows the vitals as a graph and a table, and lets the clinician add a new vital reading that is written straight back into the patient's chart.

### Features

- EHR launch. Epic opens the app's URL with `iss` and `launch` in the query string. The app discovers the authorization and token endpoints from `iss`, runs OAuth 2.0 authorization code with PKCE, and passes the launch token through. There is no login screen and no patient picker. The clinician never leaves their workflow.
- A manual launch form for testing. When the app is opened without launch parameters, it shows a form to paste a FHIR base URL, a client ID, and a launch token taken from Epic's launcher or from Postman.
- A compact patient banner that always shows whose chart is on screen, and an encounter line that shows which visit the app was launched in.
- Vitals by type. Each vital type has a tile with the latest value. The selected type shows as a line graph or as a table, with a date range filter. Blood pressure plots systolic and diastolic on one graph.
- Add a reading. For the selected vital type, the clinician types a number and saves. The app writes an `Observation` to Epic with the code, unit, patient, and encounter already filled in. The new reading then appears in the graph and the table, read back from Epic.
- Medications, active first, with instructions and prescriber.
- A FHIR panel that lists every request to Epic: the discovery request, the token request, every read, and every write. Each request expands to show its headers with the bearer token, its request body, and its response body.
- Behaves inside Epic Hyperspace, which embeds the app in a sidebar, a floating window, or an external browser and does not share a normal browser's storage.
- Clear errors. A failure in one section never blanks the page. A failed write shows what Epic said.

This prompt is a specification. Follow it exactly. Where it says "do not", do not. Where a value is given, use that value. Do not substitute libraries, endpoints, or flows you think are equivalent. If something is ambiguous, pick the simplest option that satisfies the spec and leave a code comment explaining the choice.

### 1. Architecture (non-negotiable)

- Frontend only. No backend, no serverless functions, no API routes, no proxy. The browser talks directly to Epic.
- Stack: Vite + React + TypeScript. Plain CSS or Tailwind for styling. No component library is required.
- If the platform cannot run Vite, a single `index.html` with vanilla JavaScript is acceptable. Every requirement below still applies.
- No routing library. The app has one route, `/`. Behaviour is decided by the URL query string and by what is in `sessionStorage` (see section 5).
- Dev server must run on port 3000 and fail if that port is taken. In `vite.config.ts` set `server: { port: 3000, strictPort: true }`.
- Store nothing in `localStorage`. Use `sessionStorage` only, and only as described in sections 4 and 5. Never store the access token in a cookie. Never rely on cookies at all.
- No OAuth or FHIR client libraries (do not use `fhirclient`, `oidc-client`, `@auth0/*`, or similar). Implement the flow with `fetch` and the Web Crypto API. The point of this app is to see every step.
- Only external dependencies allowed: `react`, `react-dom`, `vite`, `typescript`, and optionally `tailwindcss`. Nothing else.
- No chart library. Draw the vitals graph as plain inline SVG in a React component (section 7).
- No popups and no iframes. Do not call `window.open`. Hyperspace blocks or mishandles both.

### 2. Configuration

Before writing any code, ask me for my Epic client ID. I registered the app on fhir.epic.com and have the non-production ID. Do not start building until you have it, do not invent one, and do not hardcode any client ID in the source. Put the value I give you in `.env` as `VITE_EPIC_CLIENT_ID`.

Create `src/config.ts` with exactly these exported constants:

```ts
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
```

Also create `.env.example` containing `VITE_EPIC_CLIENT_ID=` and read the client ID from `.env`. Do not commit `.env`. If `CLIENT_ID` is empty at runtime, the manual launch form's client ID field is empty and Screen A shows "No client ID is configured. Set VITE_EPIC_CLIENT_ID in .env and restart the dev server, or paste a client ID below." A launch from Epic with an empty client ID and no pasted client ID stops with that same message.

There are no hardcoded authorize or token URLs. A provider app is installed at many hospitals and each one has its own FHIR server, so the app must discover the endpoints at launch time (section 4).

### 3. Screens

There are exactly three screens, rendered by one `App` component based on state. No page reloads except the redirect to Epic and the redirect back.

**Screen A: Launch**
- App name "VitalCheck" and one sentence: "VitalCheck is opened from inside Epic. Epic passes the patient and the visit, and the app shows that patient's vitals."
- A box titled "Launch manually" for testing outside Epic, with three text fields and one button:
  - "FHIR base URL", prefilled with `SANDBOX_FHIR_BASE_URL`.
  - "Client ID", prefilled with `CLIENT_ID`. Editable, so a learner can test another registration without editing `.env`.
  - "Launch token", empty. A one-line hint under it: "Paste the `launch` value from Epic's launcher URL. Open fhir.epic.com, go to Documentation, Launching your app from Epic, and use Try It."
  - A primary button "Launch". Disabled until all three fields are non-empty. Clicking it runs the launch flow in section 4 with these values, exactly as if Epic had sent them.
- Below the box, a small grey note: "In a hospital this screen is never seen. Epic opens the app with the patient already selected."
- If the page was opened with an `error` in the query string, or a previous step failed, show the error in a red box above the form.

**Screen B: Launching**
- Shown from the moment launch parameters are read until the chart is ready.
- Show a list of steps with a tick as each completes: "Reading launch parameters", "Discovering Epic endpoints", "Redirecting to Epic", "Verifying launch", "Loading patient", "Loading encounter", "Loading vitals", "Loading medications". The first three happen before the redirect and the rest after it, so after the redirect the first three show as already done.
- If any step fails, show the error (section 8) and a "Start over" button that clears `sessionStorage` and shows Screen A.

**Screen C: Chart**
- A compact patient banner at the top, always visible: the text "Showing chart for" above the full name, then date of birth with age, gender, and MRN on one line. Keep it to two lines of text. Hyperspace already shows the patient above the app, so this banner is a safety check, not a hero section. It must still be present.
- Directly under the banner, an encounter line: "Visit: <class> · <status> · started <date>" from the `Encounter` resource (section 7). If the launch carried no encounter, show "Visit: none in this launch. New readings cannot be saved." in an amber colour. If the encounter could not be loaded, show "Visit: Encounter/<id> (details could not be loaded)".
- Two tabs: "Vitals" and "Medications". "Vitals" is selected on load. Tabs are buttons with `aria-selected`. Switching tabs does not refetch anything.
- A "FHIR panel" (section 9). On screens 1100px and wider it is a right-hand column of 380px, always open. Below 1100px it is a collapsible block at the bottom of the page, closed by default, with a "FHIR panel" toggle button in the header.
- A "Close session" button in the header that clears `sessionStorage` and returns to Screen A.
- A footer line: "Data from <FHIR base URL host> via Epic FHIR. Access token expires at HH:MM."

### 4. Launch flow (SMART EHR launch with PKCE)

**On app load**, before rendering anything, check `window.location.search`. There are exactly four cases, checked in this order:

1. `iss` and `launch` are both present: this is an EHR launch. Start the launch flow below with `iss` (after `URLSearchParams` has decoded it) and `launch`. Do this even if a valid session already exists in `sessionStorage`; a new launch always starts fresh and replaces any saved session. Clear the query string with `history.replaceState({}, "", "/")` as soon as both values are read.
2. `error` is present: show Screen A with `error` and `error_description` in a red box. Clear the query string.
3. `code` is present: complete the flow (section 5).
4. Otherwise: if a valid session exists (section 5) show Screen C, else Screen A.

If only one of `iss` or `launch` is present, treat it as case 2 with the message "Incomplete launch. Both iss and launch are required."

**Launch flow**, run for an EHR launch and for the manual launch form:

1. `iss` must start with `https://`. If not, stop with "The FHIR base URL must use https." Trim a trailing slash. This is the FHIR base URL for the whole session. Do not allowlist it in this app; a real app would compare it to the list of hospitals where it is installed.
2. Fetch the SMART discovery document: `GET {iss}/.well-known/smart-configuration` with the single header `Accept: application/json`. No `Authorization` header. Read `authorization_endpoint` and `token_endpoint` from the JSON. If the request fails or either field is missing, stop with "Could not discover Epic's OAuth endpoints from <iss>." Log this request in the FHIR panel with section `discovery`.
3. Generate a `code_verifier`: 64 random bytes from `crypto.getRandomValues`, base64url encoded (RFC 7636). Base64url means: standard base64, then replace `+` with `-`, `/` with `_`, strip `=` padding.
4. Generate `code_challenge` = base64url(SHA-256(code_verifier)) using `crypto.subtle.digest("SHA-256", ...)`. Method is `S256`. Never use `plain`.
5. Generate `state`: 32 random bytes, base64url encoded.
6. Save to `sessionStorage` under the key `vc_launch_<state>` one JSON string: `{ code_verifier, iss, authorization_endpoint, token_endpoint, client_id, launch }`. The key includes the state on purpose. Hyperspace can open the app for two patients in two windows that share storage, and a fixed key would let one window overwrite the other's verifier. Do not write a fixed key such as `pkce_verifier`.
7. Build the authorize URL from `authorization_endpoint` with `URLSearchParams` and these parameters, all required:
   - `response_type` = `code`
   - `client_id` = the client ID in use
   - `redirect_uri` = `REDIRECT_URI`
   - `scope` = `SCOPES`
   - `state` = the state value
   - `aud` = `iss`. Epic has required this since May 2023. Without it the authorize request fails.
   - `launch` = the launch token, exactly as received. Treat it as opaque. It happens to be a JWT today, but it is not part of the spec and Epic may change it. Never decode it and never read anything out of it.
   - `code_challenge` = the challenge
   - `code_challenge_method` = `S256`
8. `window.location.assign(authorizeUrl)`. Do not open a popup. Do not use an iframe.

Because the launch token proves that a clinician is already signed in to Epic, Epic shows no login and no consent screen. It redirects straight back to `REDIRECT_URI` with `?code=...&state=...` on success, or `?error=...&error_description=...` on failure. To the clinician it looks like the app simply opened.

**On the callback** (case 3 above):

1. Read `state` from the URL. Look up `sessionStorage` key `vc_launch_<state>`. If it is missing, stop, show "Launch could not be verified (unknown state). Start the launch again from Epic." Do not exchange the code.
2. Clear the query string immediately with `history.replaceState({}, "", "/")` so a refresh does not resend a used code.
3. Exchange the code (section 5) using the `token_endpoint`, `client_id`, and `code_verifier` from the saved launch entry.
4. Delete `vc_launch_<state>` after the exchange, whether it succeeded or failed.

### 5. Token exchange and session

Make exactly this request from the browser, to the `token_endpoint` from the saved launch entry:

```
POST <token_endpoint>
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code from URL>
&redirect_uri=<REDIRECT_URI, identical to the authorize step>
&client_id=<client_id from the saved launch entry>
&code_verifier=<code_verifier from the saved launch entry>
```

- Encode the body with `URLSearchParams`. Do not send JSON.
- Do not send an `Authorization` header. Do not send a `client_secret`. This is a public client.
- Do not send `Accept: application/json` or other unnecessary headers. `Content-Type` only.
- If the response status is not 200, read the body as text and surface it (section 8).

The successful response is JSON. Fields to use:

- `access_token`: opaque string. Attach to every FHIR request. Never decode it or rely on its contents.
- `expires_in`: seconds. Compute `expires_at = Date.now() + expires_in * 1000`. Do not hardcode a lifetime.
- `patient`: the FHIR ID of the patient the clinician had open when they launched the app. This is the patient context. Use it for every FHIR call. Never search for a patient and never show a patient list. The clinician already chose the patient in Epic.
- `encounter`: the FHIR ID of the visit the app was launched in. Present only when the launch carried an encounter. Required for writing vitals (section 7). May be absent; the app must cope.
- `id_token`: a JWT. Decode the payload only (base64url decode the middle segment, no signature verification) and read `fhirUser` for display in the FHIR panel. Nothing in the app logic depends on it.
- `scope`: the scopes actually granted. Show in the FHIR panel.
- Ignore `__epic.dstu2.patient`, `epic.dstu2.patient`, and any other fields.

There will be no `refresh_token`. Epic does not issue refresh tokens to public clients without a secret. Do not request the `offline_access` scope. Do not implement refresh. When the token expires, the clinician relaunches from Epic.

Save to `sessionStorage` as one JSON string under key `vc_session`: `{ access_token, expires_at, patient, encounter, fhir_base_url, token_endpoint, scope, fhirUser }`. `fhir_base_url` is the `iss` from the launch entry. `encounter` is `null` when absent.

A session is valid if `vc_session` exists and `expires_at > Date.now() + 30000`. A saved session is used only for a page refresh with no query string. A new launch (section 4, case 1) always replaces it.

### 6. FHIR requests

Every read request uses these headers and nothing else:

```
Authorization: Bearer <access_token>
Accept: application/fhir+json
```

The write request (section 7) adds `Content-Type: application/fhir+json`.

`{base}` below is `vc_session.fhir_base_url`. `{id}` is `vc_session.patient`. `{enc}` is `vc_session.encounter`. Always include `patient={id}` on searches.

Run these in this order after the token lands. Run them sequentially, not in parallel, so failures are attributable.

1. `GET {base}/Patient/{id}`
   Returns a single `Patient` resource (not a Bundle).

2. `GET {base}/Encounter/{enc}`
   Only when `{enc}` is not null. Returns a single `Encounter` resource. If this request fails with any status, mark the encounter as "could not be loaded", keep `{enc}` for writes, and continue. Skip this step entirely when `{enc}` is null and mark the step as done with the note "no encounter in this launch".

3. `GET {base}/Observation?patient={id}&category=vital-signs`
   Returns a `Bundle`. Epic requires `category` or `code` on Observation searches. Without one it returns an error.

4. `GET {base}/MedicationRequest?patient={id}`
   Returns a `Bundle`.

**Pagination.** A search `Bundle` may contain `link` entries. If there is an entry with `relation === "next"`, fetch its `url` with the same headers and append its `entry` array. Follow at most 5 next links per search, then stop. The sandbox has patients with over 250 vitals; do not try to fetch them all.

**Bundle handling.** `bundle.entry` may be absent. Treat absent as empty. Collect `entry[].resource`. Skip any entry whose `resource.resourceType === "OperationOutcome"`; if an `OperationOutcome` is the only content and its severity is `error`, treat the request as failed and show its `issue[0].diagnostics` or `issue[0].details.text`.

**HTTP errors.**
- 401: token is invalid or expired. Clear `vc_session` and show Screen A with "Your session has expired. Launch the app again from Epic."
- 403: show "Epic did not grant access to this data type." for that section only and continue with the next section.
- Any other non-2xx: show the status and response body text for that section, mark the section as failed, and continue. A failure in one section must not blank the whole page.

**Re-fetching vitals.** After a successful write (section 7), run request 3 again, including pagination, and replace the vitals in memory with the new result. The new reading must come from Epic's response, not from local state. Log the re-fetch like any other request.

### 7. Data mapping and display

General rules for all sections:
- Never show a raw code to the user. Show `.text` if present, else `coding[0].display`, else `coding[0].code` as a last resort with the label "(code)".
- Every field can be missing. Missing means "Not recorded", never a crash and never `undefined` on screen.
- Sort by date, most recent first. Missing dates sort last.
- Show at most the number of items stated, with a "Show all (N)" toggle that expands to the full list.
- Units: Epic often sends the UCUM code as the unit. Show these as people write them, and show any other unit exactly as received: `mm[Hg]` as `mmHg`, `Cel` as `°C`, `[degF]` as `°F`, `[lb_av]` as `lb`, `[oz_av]` as `oz`, `[in_i]` as `in`, `kg/m2` as `kg/m²`, `{beats}/min` and `{breaths}/min` as `/min`. Never convert a value from one unit to another. Display mapping is for display only; the unit sent back to Epic is the raw unit (see "Add a reading").

**Patient banner** (from the `Patient` resource):
- Name: prefer the entry in `name[]` with `use === "official"`, else `name[0]`. Display as `given.join(" ") + " " + family`. If `name[i].text` exists, use it instead.
- Date of birth: `birthDate`, formatted as a readable date, followed by the age in years computed from it, for example "12 Mar 1987 (39 y)".
- Gender: `gender`, capitalised.
- MRN: from `identifier[]`, the entry whose `type.coding[].code === "MR"` or whose `type.text` contains "MRN". Show as "MRN: value" if found, else omit.

**Encounter line** (from the `Encounter` resource):
- Class: `class.display`, else `class.code`, else "Visit".
- Status: `status` as is (for example `in-progress`, `finished`).
- Start: `period.start` formatted as a readable date and time, else "start not recorded".
- Also show `serviceProvider.display` or `location[0].location.display` after the start, if either exists.

**Medications** (`MedicationRequest` resources), on the Medications tab:
- Show up to 10.
- Drug name: `medicationCodeableConcept` via the general rule. If instead `medicationReference` is present, show `medicationReference.display` if it exists, else "Medication (details not available)". Do not fetch the referenced `Medication` resource.
- Instructions: `dosageInstruction[0].text` if present, else "No instructions on file".
- Status: `status` as a tag. Show `active` first, then everything else.
- Date: `authoredOn`.
- Prescriber: `requester.display` if present.

**Vitals** (`Observation` with category vital-signs), on the Vitals tab:

Group the observations by vital type. Match the eight known types on LOINC code in `code.coding[]` where `system === "http://loinc.org"`. Keep them in this fixed order:

| Type | LOINC code |
| --- | --- |
| Blood pressure | `85354-9` |
| Heart rate | `8867-4` |
| Body temperature | `8310-5` |
| Respiratory rate | `9279-1` |
| Oxygen saturation | `2708-6` or `59408-5` |
| Height | `8302-2` |
| Weight | `29463-7` |
| BMI | `39156-5` |

- Blood pressure reads `component[]`: systolic is the component with code `8480-6`, diastolic is `8462-4`. Display as `systolic/diastolic mmHg`.
- Any vital-sign observation that matches none of these codes is an "other" vital. Group other vitals by their name, using the general rule on `code`. Each distinct name is its own type.
- Within a type, sort readings by date, most recent first. The date is `effectiveDateTime`, else `issued`.
- Keep the original `Observation` resource on every reading. The write-back needs it.

*Tiles.* Show one tile per type in a grid.
- The eight known types always show, in the order above. A known type with no readings shows "Not recorded" and cannot be selected.
- Other vitals show in a second grid under the heading "Other vitals". Omit the heading when there are none.
- A tile with data shows: label, latest value with unit, date measured, and the number of readings, for example "6 readings".
- A tile with data is a button. Clicking it selects that type. Exactly one type is selected at a time. On load, select the first type that has data. Show the selected tile highlighted and set `aria-pressed`. The grid must fit a 390px wide sidebar: two tiles per row at that width.

*Detail.* Below the tiles, show the selected type: its name, the number of readings in the current date range, and the unit. Then a toolbar, then the graph or the table, then the "Add a reading" form.

*Toolbar.* Two segmented controls with small uppercase labels:
- "Date range": "All time", "Last 30 days", "Last 90 days", "Last year", "Custom". Presets count back from the start of today. "Custom" reveals two `<input type="date">` fields, From and To, which default to the earliest and latest dated reading of the selected type. From is the start of its day, To is the end of its day. A reading with no date is shown under "All time" only.
- "View": "Graph" and "Table".
- A segmented control is a light grey rounded track; the selected segment is white with a small shadow and semibold text. Mark the selected segment with `aria-pressed`.
- Defaults are "All time" and "Graph". They reset when another type is selected.

*Graph.* A line chart of the readings in range over time, drawn as inline SVG.
- X axis is time, oldest on the left. Y axis is the value. Use one y axis only. Never draw two y scales on one chart.
- Blood pressure draws two lines on the same axis, systolic and diastolic, with a legend above the chart. Every other type draws one line and no legend.
- Series colours are fixed by position: first series `#2a78d6`, second series `#eb6834`. Define them as CSS custom properties. These two were checked for colour-blind separation and contrast on a white surface.
- Lines are 2px with round joins. Gridlines are solid 1px hairlines in a light grey. Do not use dashed lines.
- Draw a marker on every point (radius 4, with a 2px ring in the surface colour) when the chart has 30 points or fewer. With more than 30 points draw the line only.
- Y ticks are clean numbers: steps of 1, 2, or 5 times a power of ten, about four steps. Do not force the y axis to start at zero.
- X ticks are evenly spaced in time, between 2 and 6 depending on width. Label them by span: year only over 2 years, month and year over 60 days, month and day otherwise. Do not repeat a label.
- Label the last value of each line directly at its right end. If two end labels would be less than 14px apart, drop the end labels.
- All text uses text colours. Only lines and markers use the series colour.
- A missing value breaks the line. Do not draw a line across a gap.
- Size the chart to the real pixel width of its container with a `ResizeObserver`. Do not scale text with a `viewBox`. The chart must fit a 390px wide screen with no horizontal page scroll.
- Hover: a vertical hairline snaps to the reading nearest to the pointer's x position, and a tooltip shows the date and the value with unit for every series. The pointer does not have to touch the line. The whole plot area is the hit target.
- Keyboard: the chart is focusable. Focus shows the latest reading. Left and right arrows move one reading, Home and End jump to the first and last, Escape hides the readout. Mirror the readout in an `aria-live` region.
- The tooltip never holds information that is missing from the table.

*What is plotted.*
- The chart uses one unit: the unit of the most recent numeric reading of that type.
- A reading is plotted only if it has a date, a numeric value, and that same unit. Every other reading stays in the table but is left off the graph, because mixing units such as kg and lb on one axis draws a false trend. Never convert units.
- When some readings are left off, say how many under the graph, for example "1 reading is in the table but not on the graph, because it has no date, no numeric value, or a different unit."
- With exactly one plottable reading, show no graph and the text "Only one reading can be plotted. A graph needs at least two. Switch to the table view to see it."
- With no plottable reading, show no graph and the text "These readings have no numeric value, so there is no graph."

*Table.* Every reading of the selected type in range, most recent first.
- Columns are Date and Value. Blood pressure has three columns: Date, Systolic, Diastolic, with the unit in the column header.
- Right-align numbers and use tabular figures.
- Show up to 10 rows with the "Show all (N)" toggle. Reset the toggle when another type is selected.
- Put the table in a box that scrolls sideways, so a wide table never stretches the page.

*Add a reading.* A form under the graph or table, inside a bordered box titled "Add a reading", for the selected type.

The form copies everything except the value from the most recent reading of the selected type, exactly as Epic returned it. This is deliberate: Epic accepts only codes that are mapped to a flowsheet row at that site, and the surest way to send an acceptable code is to send back one Epic itself sent. So:

- The form is enabled only when all of these hold: the selected type has at least one reading, `vc_session.encounter` is not null, and the most recent reading has a `valueQuantity` with a numeric `value` and a `unit` (or `code`), or, for blood pressure, two components that each have one. Otherwise the form shows a greyed-out reason instead of inputs: "No existing reading to copy the code and unit from", "No encounter in this launch. Epic needs an open visit to file a vital.", or "The latest reading has no numeric value and unit to copy."
- Fields: for every type except blood pressure, one `<input type="number" step="any">` labelled "Value" with the unit shown as a read-only suffix after the input. For blood pressure, two inputs, "Systolic" and "Diastolic", each with the unit suffix. The unit suffix uses the display mapping; the unit sent is the raw unit.
- Below the inputs, a muted line: "Will be filed as <code display> (LOINC <code>) at <current time> for Encounter/<enc>." Update the time when the form opens, not every second.
- A primary button "Save to Epic". Disabled while a value is empty or not a finite number, and while a save is in flight. While in flight the button reads "Saving…".
- On click, build and send the request below. On success, clear the inputs, show a green line "Saved. Reading <newId or 'created'> is now in the chart." and re-fetch vitals (section 6). The selected type, date range, and view stay as they were. On failure, show the error (section 8) inside the form box and keep the typed values.

The write request:

```
POST {base}/Observation
Authorization: Bearer <access_token>
Accept: application/fhir+json
Content-Type: application/fhir+json
```

Body for a single-value type, built from the most recent reading `r` of that type:

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [
    { "coding": [ { "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" } ] }
  ],
  "code": <r.code, copied as is>,
  "subject": { "reference": "Patient/<id>" },
  "encounter": { "reference": "Encounter/<enc>" },
  "effectiveDateTime": "<new Date().toISOString()>",
  "valueQuantity": {
    "value": <typed number>,
    "unit": <r.valueQuantity.unit, else r.valueQuantity.code>,
    "system": <r.valueQuantity.system, else "http://unitsofmeasure.org">,
    "code": <r.valueQuantity.code, else r.valueQuantity.unit>
  }
}
```

Body for blood pressure: the same, with no `valueQuantity`, and a `component` array of two entries. Each entry copies `code` from the matching component of `r` (systolic `8480-6`, diastolic `8462-4`) and has a `valueQuantity` built from the typed number and that component's unit, system, and code, with the same fallbacks.

- Copy `code` from the reading whole, including every `coding` entry and `text`. Do not rebuild it from the LOINC table above. Do not add or remove codings.
- Do not send `id`, `meta`, `identifier`, `issued`, `performer`, or any other field from the source reading. Only the fields shown above.
- Epic answers a successful create with status 201, usually an empty body, and a `Location` header ending in `/Observation/<newId>`. Read the new ID from that header if it is present. Treat any 2xx as success even when the body is empty. Do not try to parse an empty body as JSON.
- A failed create is usually a 400 with an `OperationOutcome` body. Show `issue[0].diagnostics` or `issue[0].details.text` to the user. Common Epic messages are about a closed encounter, a missing encounter, or a code with no matching flowsheet row.

### 8. Error handling

- Every `fetch` is wrapped in try/catch. A network failure shows: "Could not reach Epic. Check your connection and try again."
- OAuth errors from the redirect show `error` and `error_description` verbatim.
- Discovery and token exchange failures show the HTTP status and the raw response body in a collapsible "Details" block.
- A failed write shows the HTTP status, the `OperationOutcome` text if there is one, and a collapsible "Details" block with the raw response body. It never clears the form.
- Never swallow an error. Never fall back to fake data. If there is no data, say so.

### 9. FHIR panel

A panel titled "FHIR panel" on Screen C (placement in section 3). It has two parts.

**Launch context**, a small key-value list at the top:
- FHIR base URL (`fhir_base_url`)
- `patient` ID from the token response
- `encounter` ID from the token response, or "none"
- `fhirUser` from the ID token
- granted `scope`
- `expires_at` as a readable time

**Requests**, a list of every request made, in order, as expandable rows. Each row shows: method, full URL, HTTP status, and, for a search, the number of resources returned. Pagination requests are listed as their own rows. Group the rows under these headings in this order, omitting a heading with no rows: "Discovery", "Token", "Patient", "Encounter", "Vitals", "Medications", "Writes".

The discovery and token rows exist only on the page load that handled the launch and the redirect. After a refresh the saved session is reused and no discovery or token request is made; in that case show under those headings "No request was made on this page load. The saved session was reused. Launch again from Epic to see it."

Each request is a row that expands when clicked. Expanded, it shows three blocks in this order:

1. **Request headers**, exactly as sent, one per line as `Name: value`. For FHIR requests this includes the full `Authorization: Bearer <access_token>` header with the real token. Do not mask or shorten it.
2. **Request body**, exactly as sent. The token request shows its form-encoded body, one parameter per line. The write shows its JSON body, pretty-printed with 2-space indentation. A request with no body shows "No request body. GET requests do not send one."
3. **Response body**, as received. If it is JSON, pretty-print it with 2-space indentation. Otherwise show the raw text. Show error bodies too. If the body is empty, show "Empty response body." and, for the write, also show the `Location` response header on its own line.

Under the Vitals heading, after the rows, add a block "How the response was grouped": the number of observations returned and the number of vital types they were grouped into, for example "57 observations grouped into 7 vital types.", then a table with one row per vital type that has data: the type name, what it was matched on (`LOINC <codes>` for known types, "code text" for other vitals), the number of readings, the number of readings on the graph, and the unit. Show the Vitals heading even when the vitals request failed, so the error body can be inspected; leave out the grouping block in that case. Update the block after every re-fetch.

To support this, give every log entry a `section` field with one of: `discovery`, `token`, `patient`, `encounter`, `vitals`, `medications`, `create`. Set it where the request is made.

Rules for the log behind this panel:
- Record each entry in the same function that calls `fetch`, and pass the same headers object to `fetch` and to the log, so the panel shows what was really sent.
- Read every response with `response.text()` first, store that text, then parse it with `JSON.parse` only if it is non-empty. Do not call `response.json()`.
- Record the response `Location` header when present.
- Keep the log in memory only. Do not write request or response payloads to `sessionStorage`.
- Put each payload in a box with a maximum height and its own scrollbar, so a large Bundle does not stretch the page. Render a payload only while its row is open.

This panel is for learners. It shows the access token and the raw payloads on purpose, so they can see every step. That is acceptable only because the app runs against the Epic sandbox with test patients. Remove the token and the payloads from the panel before using this app with real patient data.

### 10. Hyperspace rules

Epic Hyperspace (also called Hyperdrive) opens the app inside a sidebar, an embedded pane, a floating window, or an external browser. The embedded modes are not a normal browser. Design for this:

- The whole app, including Screen C with the FHIR panel closed, must work at 390px wide with no horizontal page scroll. Test at that width.
- Do not use `localStorage`. Do not use cookies. Do not use `document.referrer` or `window.opener` for anything.
- Hyperspace can open two copies of the app for two patients and let them share storage. That is why the launch entry is keyed by `state` (section 4) and why a new launch always replaces `vc_session` (section 5). Never read patient or encounter from a saved session when launch parameters are present.
- Do not open links with `target="_blank"`. Do not call `window.open`.
- Do not depend on a service worker, notifications, clipboard, or any permission prompt.
- Keep page load light: no web fonts, no large images.

### 11. Things that must not happen

- Do not use the OAuth implicit flow (`response_type=token`).
- Do not put the access token in the URL, in `localStorage`, or in a cookie.
- Do not add a client secret anywhere, including as an environment variable.
- Do not hardcode a client ID anywhere in the source. It comes from `.env` or the manual launch form only.
- Do not hardcode a patient ID or an encounter ID. They always come from the token response.
- Do not hardcode the authorize or token URL. They always come from `.well-known/smart-configuration` of the `iss`.
- Do not decode the `launch` token.
- Do not show a patient list or a patient search.
- Do not call `/Medication`. That is the drug catalogue, not the patient's medications.
- Do not call `/Observation` without a `category` parameter.
- Do not search for encounters. The only encounter the app knows is the one from the launch.
- Do not request scopes not listed in `SCOPES`.
- Do not use `Accept: application/json` on FHIR requests. Use `application/fhir+json`. (`application/json` is correct only for the discovery document.)
- Do not build the write-back `code` from the LOINC table. Copy it from a reading Epic returned.
- Do not add the new reading to the chart from local state. Re-fetch it from Epic.
- Do not use any UI, auth, or FHIR library beyond the dependencies listed in section 1.
- Do not use a chart library. Do not draw a chart with two y axes. Do not convert units.
- Do not generate placeholder or sample clinical data anywhere in the codebase.

### 12. Deliverables

- Full source in a runnable state.
- `README.md` with:
  - How to set `VITE_EPIC_CLIENT_ID` and how to run (`npm install`, `npm run dev`).
  - What to register on fhir.epic.com: application audience "Clinicians or Administrative Users"; FHIR R4 resources `Patient.Read`, `Encounter.Read`, `Observation.Read (Vitals)`, `Observation.Search (Vitals)`, `Observation.Create (Vitals)`, `MedicationRequest.Read`, `MedicationRequest.Search`; SMART scopes `openid` and `fhirUser`; SMART on FHIR version R4; SMART scope version v1; redirect URI `http://localhost:3000` with no trailing slash; "Can Register Dynamic Clients" off; "Is Confidential Client" off; and the box that saves the app for the sandbox ticked. Say that a clinician app has no automatic client distribution and that scopes cannot be changed after the app is marked ready for production, so register only what is needed.
  - A note that a newly registered client ID can take up to 24 hours to work and returns `invalid_client` until then.
  - How to launch for testing: on fhir.epic.com open Documentation, then "Launching your app from Epic", click "Try It", pick the app and a test patient, enter `http://localhost:3000` as the launch URL, and click Launch. Also explain "Generate URL Only" and pasting its `launch` value into the manual launch form.
  - A sentence that Epic's hospital-side testing harness, "Testing integrations in Hyperdrive", lets you open the same app inside a real Hyperspace client, and that section 10 exists because of it.

### 13. Acceptance test

The app is done when all of these pass, in order, with a fresh browser session:

1. `npm run dev` starts on `http://localhost:3000/` with no console errors. Screen A shows the manual launch form with the FHIR base URL and client ID prefilled and the "Launch" button disabled.
2. Using Epic's launcher with the app and a test patient selected and `http://localhost:3000` as the launch URL, clicking Launch opens `http://localhost:3000/?iss=...&launch=...`. Within a second the query string is gone, Screen B shows the first three steps, and the browser redirects to a URL on the discovered authorization endpoint containing `launch=`, `aud=https%3A%2F%2Ffhir.epic.com%2Finterconnect-fhir-oauth%2Fapi%2FFHIR%2FR4`, `scope=launch+`, and `code_challenge_method=S256`.
3. Epic shows no login and no consent, and returns to `http://localhost:3000/?code=...&state=...`. The query string is removed within a second.
4. Screen B shows all eight steps completing, with "Loading encounter" either loaded or marked "no encounter in this launch".
5. Screen C shows a patient banner with a real name and date of birth, an encounter line, at least one vital tile with data, and the Medications tab lists at least one medication.
6. The FHIR panel's launch context shows the `patient` ID and, when the launch carried one, the `encounter` ID. The Discovery row shows a 200 with `authorization_endpoint` and `token_endpoint` in its response body. The Token row shows the form-encoded request body and a JSON response containing `patient`.
7. Refreshing the page keeps Screen C without going through Epic again, and the Discovery and Token headings show the "saved session was reused" note.
8. The Vitals tab shows eight tiles in the fixed order, two per row at 390px wide. The first tile with data is selected. Clicking "Table" replaces the graph with a table. Choosing "Last 30 days" changes the reading count, and "All time" restores it. Hovering the graph shows a tooltip with a date and a value.
9. With a type that has data selected and an encounter in the launch, the "Add a reading" form is enabled with the unit shown. Entering a value and clicking "Save to Epic" produces a Writes row in the FHIR panel with method `POST`, a JSON request body containing `"status": "final"`, `"encounter"`, and the copied `code`, and a 201 status. A new Vitals row appears for the re-fetch, and the new reading is in the table with today's date.
10. Pasting a launch token from "Generate URL Only" into the manual launch form and clicking "Launch" runs steps 2 to 5 again for the patient chosen in the launcher.
11. Manually setting `vc_session.encounter` to `null` in `sessionStorage` and refreshing shows the amber encounter line and the disabled form with the "No encounter in this launch" reason. Saving is impossible.
12. "Close session" returns to Screen A. Refreshing then stays on Screen A.
13. Manually setting `expires_at` in `sessionStorage` to a past time and refreshing shows Screen A with the session expired message.

If any step fails, fix the app. Do not mark the task complete until all thirteen pass.

### 14. Known sandbox behaviours (do not "fix" these)

- A newly registered clinician app's client ID can return `invalid_client` for up to 24 hours after registration. If the sandbox box was not ticked on the registration form, the client ID never works in the sandbox.
- Epic's launcher sometimes launches without an encounter. The token response then has no `encounter` field. The app shows the amber line and disables writes. This is correct behaviour.
- A successful `POST /Observation` returns 201 with an empty body. The new reading is visible only after the re-fetch, and Epic may take a moment to include it.
- Epic files a vital to a flowsheet row. The sandbox maps standard LOINC codes to rows, so copying the code from an existing reading works. A hospital may use site-specific flowsheet IDs instead; that is an installation detail, not an app bug. Error codes in the 59187 to 59189 range mean Epic found no matching row or could not file the reading.
- Writing BMI or height can fail at some sites because Epic calculates those itself. The error from Epic is shown; nothing else needs to change.
- Some sandbox patients have empty sections. An empty section with "Not recorded" is correct behaviour, not a bug.
- If Epic returns `error=invalid_request` or a page saying the request is invalid before redirecting back, the `redirect_uri` sent does not match the registered one. The app sends `window.location.origin`, which is `http://localhost:3000` with no trailing slash; register exactly that.
- If the token exchange returns `invalid_grant`, the usual causes are: the redirect URI sent does not exactly match the registered one, the code was already used (refresh after callback), the code verifier does not match the challenge, or the launch token was already used (launch tokens are single use; generate a new one from the launcher).
