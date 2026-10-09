# CareSummary build prompt

This is the exact prompt CareSummary was built from. Paste it whole into a coding agent to build the app yourself. The prompt asks for your Epic client ID before it writes any code, so register the app on fhir.epic.com first (see the [README](README.md)).

---

Build a web app called **CareSummary**. It is a patient-facing SMART on FHIR app. A patient connects their Epic MyChart account, and the app reads their record from Epic's FHIR server and shows a one-page health snapshot: who they are, their conditions, their medications, and their recent labs and vitals.

### Features

- Connect to Epic MyChart with OAuth 2.0 authorization code flow and PKCE. The user selects a health system, then clicks "Connect your health records".
- A patient banner that always shows whose record is on screen.
- Conditions from the problem list, with status and onset date.
- Medications, active first, with instructions and prescriber.
- Lab results with value, unit, reference range, and high or low flag. Repeated tests collapse to the latest result.
- Vitals by type. Each vital type has a tile with the latest value, a line graph of its history, and a table of every reading. Blood pressure plots systolic and diastolic on one graph.
- A full-page vitals view, opened with "View more" from the Vitals section. It shows every vital type, filters by date range with presets or a custom range, and switches between graph view and table view.
- A Debug panel that lists every request to Epic. Each request expands to show its headers with the bearer token, its request body, and its response body.
- A second debug block inside the Vitals section that shows only the vitals requests and how the observations were grouped into vital types.
- Clear errors. A failure in one section never blanks the page.

This prompt is a specification. Follow it exactly. Where it says "do not", do not. Where a value is given, use that value. Do not substitute libraries, endpoints, or flows you think are equivalent. If something is ambiguous, pick the simplest option that satisfies the spec and leave a code comment explaining the choice.

### 1. Architecture (non-negotiable)

- Frontend only. No backend, no serverless functions, no API routes, no proxy. The browser talks directly to Epic.
- Stack: Vite + React + TypeScript. Plain CSS or Tailwind for styling. No component library is required.
- If the platform cannot run Vite, a single `index.html` with vanilla JavaScript is acceptable. Every requirement below still applies.
- No routing library. The app has one route, `/`. Behaviour is decided by the URL query string and by what is in `sessionStorage` (see section 5).
- Dev server must run on port 3000 and fail if that port is taken. In `vite.config.ts` set `server: { port: 3000, strictPort: true }`.
- Store nothing in `localStorage`. Use `sessionStorage` only. Never store the access token in a cookie.
- No OAuth or FHIR client libraries (do not use `fhirclient`, `oidc-client`, `@auth0/*`, or similar). Implement the flow with `fetch` and the Web Crypto API. The point of this app is to see every step.
- Only external dependencies allowed: `react`, `react-dom`, `vite`, `typescript`, and optionally `tailwindcss`. Nothing else.
- No chart library. Draw the vitals graphs as plain inline SVG in a React component (section 7).

### 2. Configuration

Before writing any code, ask me for my Epic client ID. I registered the app on fhir.epic.com and have the ID. Do not start building until you have it, do not invent one, and do not hardcode any client ID in the source. Put the value I give you in `.env` as `VITE_EPIC_CLIENT_ID`.

Create `src/config.ts` with exactly these exported constants:

```ts
// Comes from .env only. There is no fallback value on purpose.
export const CLIENT_ID = import.meta.env.VITE_EPIC_CLIENT_ID ?? "";

// Epic public sandbox, FHIR R4. These are fixed. Do not change them.
export const FHIR_BASE_URL = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";
export const AUTHORIZE_URL = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize";
export const TOKEN_URL = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token";

// Must exactly match a redirect URI registered on fhir.epic.com. No trailing slash.
export const REDIRECT_URI = window.location.origin;

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
```

Also create `.env.example` containing `VITE_EPIC_CLIENT_ID=` and read the client ID from `.env`. Do not commit `.env`. If `CLIENT_ID` is empty at runtime, Screen A must show "No client ID is configured. Set VITE_EPIC_CLIENT_ID in .env and restart the dev server." and both the organisation entries and the "Connect your health records" button must be disabled.

Note on the endpoints: these three URLs are what Epic publishes at `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/.well-known/smart-configuration`. Do not fetch that document at runtime. Hardcode the values above.

### 3. Screens

There are exactly three screens, rendered by one `App` component based on state. No page reloads except the redirect to Epic and the redirect back.

**Screen A: Connect**
- App name "CareSummary" and one sentence: "Connect your health record to see a one-page summary of your conditions, medications, and recent results."
- A search box labelled "Find your health system". It filters `ORGANIZATIONS` by name as the user types. With one entry, it just shows that entry. Keep the search box anyway; the real app would have many organisations.
- Clicking an organisation selects it and highlights it. Selecting does not navigate anywhere and does not start the connect flow. Do not auto-select an organisation, even when there is only one.
- Below the list, a primary button labelled "Connect your health records". It is disabled until an organisation is selected. Clicking it runs the connect flow in section 4 for the selected organisation.
- If the search text hides the selected organisation, treat nothing as selected and disable the button.
- Below the button, a small grey note: "You will be taken to your health system's MyChart login. CareSummary never sees your password."

**Screen B: Loading**
- Shown while exchanging the code for a token and while fetching FHIR data.
- Show a list of steps with a tick as each completes: "Verifying login", "Loading patient", "Loading conditions", "Loading medications", "Loading lab results", "Loading vitals".
- If any step fails, show the error (section 8) and a "Start over" button.

**Screen C: Summary**
- A patient banner at the top, always visible: full name, date of birth, gender, and the text "Showing records for" above the name. Standalone apps must show this so the user knows whose record is on screen.
- Four sections in this order: Conditions, Medications, Lab results, Vitals.
- The Vitals section has a "View more" button at the top right of its heading. It opens the full-page vitals view (section 7). That view is a full-screen `<dialog>` inside Screen C, not a fourth screen, so the app keeps one route and three screens.
- A "Disconnect" button that clears `sessionStorage` and returns to Screen A.
- A footer line: "Data from your health system via Epic FHIR. Access token expires at HH:MM."

### 4. Connect flow (OAuth 2.0 authorization code with PKCE)

When the user clicks "Connect your health records" with an organisation selected:

1. Generate a `code_verifier`: 64 random bytes from `crypto.getRandomValues`, base64url encoded (RFC 7636). Base64url means: standard base64, then replace `+` with `-`, `/` with `_`, strip `=` padding.
2. Generate `code_challenge` = base64url(SHA-256(code_verifier)) using `crypto.subtle.digest("SHA-256", ...)`. Method is `S256`. Never use `plain`.
3. Generate `state`: 32 random bytes, base64url encoded.
4. Save to `sessionStorage`: `pkce_verifier`, `oauth_state`, and `fhir_base_url` (the chosen organisation's base URL).
5. Build the authorize URL with `URLSearchParams` and these parameters, all required:
   - `response_type` = `code`
   - `client_id` = `CLIENT_ID`
   - `redirect_uri` = `REDIRECT_URI`
   - `scope` = `SCOPES`
   - `state` = the state value
   - `aud` = the organisation's `fhirBaseUrl`. Epic requires this. Without it the authorize request fails.
   - `code_challenge` = the challenge
   - `code_challenge_method` = `S256`
6. `window.location.assign(authorizeUrl)`. Do not open a popup. Do not use an iframe.

Epic will show the MyChart login and consent screen, then redirect the browser to `REDIRECT_URI` with `?code=...&state=...` on success, or `?error=...&error_description=...` on failure.

**On app load**, before rendering anything, check `window.location.search`:

- If `error` is present: show Screen A with the error and description in a red box. Clear the query string with `history.replaceState`.
- If `code` is present:
  1. Read `state` from the URL and compare to `sessionStorage.oauth_state`. If missing or different, stop, clear `sessionStorage`, show "Login could not be verified (state mismatch). Please try again." Do not exchange the code.
  2. Clear the query string immediately with `history.replaceState({}, "", "/")` so a refresh does not resend a used code.
  3. Exchange the code (section 5).
- If neither: if a valid token is in `sessionStorage` (section 5) go to Screen C, else Screen A.

### 5. Token exchange

Make exactly this request from the browser:

```
POST https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code from URL>
&redirect_uri=<REDIRECT_URI, identical to the authorize step>
&client_id=<CLIENT_ID>
&code_verifier=<sessionStorage.pkce_verifier>
```

- Encode the body with `URLSearchParams`. Do not send JSON.
- Do not send an `Authorization` header. Do not send a `client_secret`. This is a public client.
- Do not send `Accept: application/json` or other unnecessary headers. `Content-Type` only.
- If the response status is not 200, read the body as text and surface it (section 8).

The successful response is JSON. Fields to use:

- `access_token`: opaque string. Attach to every FHIR request. Never decode it or rely on its contents.
- `expires_in`: seconds. Compute `expires_at = Date.now() + expires_in * 1000`. Do not hardcode a lifetime.
- `patient`: the FHIR ID of the logged-in patient. This is the patient context. Use it for every FHIR call. Do not search for the patient by name or anything else.
- `id_token`: a JWT. Decode the payload only (base64url decode the middle segment, no signature verification) and read `fhirUser` for display in a debug panel. Nothing in the app logic depends on it.
- `scope`: the scopes actually granted. Show in the debug panel.
- Ignore `epic.dstu2.patient` and any other fields.

There will be no `refresh_token`. Epic does not issue refresh tokens to public clients without a secret. Do not request the `offline_access` scope. Do not implement refresh. When the token expires, the user reconnects.

Save to `sessionStorage` as one JSON string under key `epic_session`: `{ access_token, expires_at, patient, fhir_base_url, scope, fhirUser }`. Delete `pkce_verifier` and `oauth_state` after a successful exchange.

A session is valid if `epic_session` exists and `expires_at > Date.now() + 30000`.

### 6. FHIR requests

Every request uses these headers and nothing else:

```
Authorization: Bearer <access_token>
Accept: application/fhir+json
```

`{base}` below is `epic_session.fhir_base_url`. `{id}` is `epic_session.patient`. Always include `patient={id}` on searches even though Epic scopes results to the logged-in patient.

Run these in this order after the token lands. Run them sequentially, not in parallel, so failures are attributable.

1. `GET {base}/Patient/{id}`
   Returns a single `Patient` resource (not a Bundle).

2. `GET {base}/Condition?patient={id}&category=problem-list-item`
   Returns a `Bundle`.

3. `GET {base}/MedicationRequest?patient={id}`
   Returns a `Bundle`.

4. `GET {base}/Observation?patient={id}&category=laboratory`
   Returns a `Bundle`. Epic requires `category` or `code` on Observation searches. Without one it returns an error.

5. `GET {base}/Observation?patient={id}&category=vital-signs`
   Returns a `Bundle`.

**Pagination.** A search `Bundle` may contain `link` entries. If there is an entry with `relation === "next"`, fetch its `url` with the same headers and append its `entry` array. Follow at most 5 next links per search, then stop. The sandbox has patients with over 250 vitals; do not try to fetch them all.

**Bundle handling.** `bundle.entry` may be absent. Treat absent as empty. Collect `entry[].resource`. Skip any entry whose `resource.resourceType === "OperationOutcome"`; if an `OperationOutcome` is the only content and its severity is `error`, treat the request as failed and show its `issue[0].diagnostics` or `issue[0].details.text`.

**HTTP errors.**
- 401: token is invalid or expired. Clear `epic_session` and show Screen A with "Your session has expired. Please connect again."
- 403: show "Your health system did not grant access to this data type." for that section only and continue with the next section.
- Any other non-2xx: show the status and response body text for that section, mark the section as failed, and continue. A failure in one section must not blank the whole page.

### 7. Data mapping and display

General rules for all sections:
- Never show a raw code to the user. Show `.text` if present, else `coding[0].display`, else `coding[0].code` as a last resort with the label "(code)".
- Every field can be missing. Missing means "Not recorded", never a crash and never `undefined` on screen.
- Sort by date, most recent first. Missing dates sort last.
- Show at most the number of items stated, with a "Show all (N)" toggle that expands to the full list.
- Units: Epic often sends the UCUM code as the unit. Show these as people write them, and show any other unit exactly as received: `mm[Hg]` as `mmHg`, `Cel` as `°C`, `[degF]` as `°F`, `[lb_av]` as `lb`, `[oz_av]` as `oz`, `[in_i]` as `in`, `kg/m2` as `kg/m²`, `{beats}/min` and `{breaths}/min` as `/min`. Never convert a value from one unit to another.

**Patient banner** (from the `Patient` resource):
- Name: prefer the entry in `name[]` with `use === "official"`, else `name[0]`. Display as `given.join(" ") + " " + family`. If `name[i].text` exists, use it instead.
- Date of birth: `birthDate`, formatted as a readable date. Also show age in years computed from it.
- Gender: `gender`, capitalised.
- MRN: from `identifier[]`, the entry whose `type.coding[].code === "MR"` or whose `type.text` contains "MRN". Show as "MRN: value" if found, else omit.

**Conditions** (`Condition` resources):
- Show up to 10.
- Name: `code` via the general rule.
- Status: `clinicalStatus.coding[0].code` (e.g. active, resolved). Show as a small tag.
- Date: `onsetDateTime`, else `recordedDate`, else "Date not recorded".
- Filter out entries where `verificationStatus.coding[0].code === "entered-in-error"`.

**Medications** (`MedicationRequest` resources):
- Show up to 10.
- Drug name: `medicationCodeableConcept` via the general rule. If instead `medicationReference` is present, show `medicationReference.display` if it exists, else "Medication (details not available)". Do not fetch the referenced `Medication` resource.
- Instructions: `dosageInstruction[0].text` if present, else "No instructions on file".
- Status: `status` as a tag. Show `active` first, then everything else.
- Date: `authoredOn`.
- Prescriber: `requester.display` if present.

**Lab results** (`Observation` with category laboratory):
- Show up to 15.
- Test name: `code` via the general rule.
- Value, in this order of checks:
  - `valueQuantity`: `value` and `unit` (fallback `code`), formatted with up to 2 decimals.
  - `valueString`: as is.
  - `valueCodeableConcept`: general rule.
  - `component[]`: render each component as `code` + value on its own line.
  - none of the above: "No value recorded".
- Reference range: `referenceRange[0].text`, else `low.value` to `high.value` with unit, else omit.
- Flag: `interpretation[0].coding[0].code` if present (H, L, A, N). Show H and L with a visible marker.
- Date: `effectiveDateTime`, else `issued`.
- If several observations share the same `code` text, show only the most recent in the main list and mention "(N earlier results)".

**Vitals** (`Observation` with category vital-signs):

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

*Tiles.* Show one tile per type in a grid.
- The eight known types always show, in the order above. A known type with no readings shows "Not recorded" and cannot be selected.
- Other vitals show in a second grid under the heading "Other vitals". Omit the heading when there are none.
- A tile with data shows: label, latest value with unit, date measured, and the number of readings, for example "6 readings".
- A tile with data is a button. Clicking it selects that type. Exactly one type is selected at a time. On load, select the first type that has data. Show the selected tile highlighted and set `aria-pressed`.

*Detail.* Below the tiles, show the selected type: its name, the number of readings, the unit, then a graph, then a table.

*Graph.* A line chart of the readings over time, drawn as inline SVG.
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
- With exactly one plottable reading, show no graph and the text "Only one reading can be plotted. A graph needs at least two."
- With no plottable reading, show no graph and the text "These readings have no numeric value, so there is no graph."

*Table.* Every reading of the selected type, most recent first.
- Columns are Date and Value. Blood pressure has three columns: Date, Systolic, Diastolic, with the unit in the column header.
- Right-align numbers and use tabular figures.
- Show up to 10 rows with the "Show all (N)" toggle. Reset the toggle when another type is selected.
- Put the table in a box that scrolls sideways, so a wide table never stretches the page.

**Vitals page** (opened with "View more"):

A full-screen view for working through every vital. Implement it as a native `<dialog>` element opened with `showModal()`, styled to fill the viewport with the page background. Do not add a route. Do not add a routing library.

- Header: the text "Showing records for" above "Vitals for <patient name>", and a "Close" button at the top right. Escape also closes it. Lock page scrolling behind the dialog while it is open and restore it on close.
- Layout: a two-column grid on screens wider than 860px. The left column (220px) is a "Vital type" list. The right column holds a toolbar, a summary line, the vital blocks, and the vitals debug block. Give the page generous spacing: it is a working view, not a summary card. Keep it uncluttered: light backgrounds, hairline borders, one accent colour, and no filled blue buttons for controls.
- The "Vital type" list has one row per type: "All types" first, then the eight known types in the fixed order from the table above, then the other vitals. Each row shows the type name on the left and the number of readings in the current date range on the right, for example "Heart rate" and "41". A type with no readings at all shows "none" and is disabled. The selected row is white with a subtle shadow. "All types" is selected on open. On screens 860px wide or narrower, the list becomes a single horizontally scrolling row of pills above the toolbar.
- The toolbar has two groups with small uppercase labels: "Date range" on the left and "View" on the right.
  - "Date range" is a segmented control: "All time", "Last 30 days", "Last 90 days", "Last year", "Last 5 years", "Custom". Presets count back from the start of today. "Custom" reveals two `<input type="date">` fields below the toolbar, From and To, which default to the earliest and latest dated reading. From is the start of its day, To is the end of its day.
  - "View" is a segmented control: "Graph" and "Table".
  - A segmented control is a light grey rounded track; the selected segment is white with a small shadow and semibold text.
- Mark the selected control in each group with `aria-pressed`. Changing the date range updates every count in the type list. Filters apply to everything below them.
- A summary line under the chips: "Showing N readings across M vital types, <range>." where range is "all time", "since <date>", or "<date> to <date>". A reading with no date is counted under "All time" only; when it exists, say how many readings have no date and are hidden when a date range is set.
- Below that, one block per vital type. "All types" shows every type that has any readings, in the fixed order, including a type that is empty only because of the date range; that block says "No readings in this date range." Selecting one type shows only that type.
- Each block is a white card with: the type name, the number of readings in range and the unit, a stats row, then the graph or the table depending on the View control.
  - Stats row: "Latest" with the latest value and its date, and the lowest to highest plotted value in range as "Range". Blood pressure shows "Systolic range" and "Diastolic range" instead. Separate the stats row from the content above and below with hairlines.
  - Graph view uses the same line chart and the same plotting rules as the section. The x axis spans the readings in range only. With one plottable reading or none, show the same explanation as the section with the added sentence "Switch to the table view to see it."
  - Table view uses the same table as the section, with up to 25 rows and the "Show all (N)" toggle. Cap the table at 640px wide so the columns stay close together instead of stretching across the card.
- At the bottom of the page, the same "Debug: vitals requests" block as the section (section 9).
- Defaults reset every time the page is opened: all time, graph view, all types.
- The page must fit a 390px wide screen with no horizontal scroll inside the dialog.

### 8. Error handling

- Every `fetch` is wrapped in try/catch. A network failure shows: "Could not reach Epic. Check your connection and try again."
- OAuth errors from the redirect show `error` and `error_description` verbatim.
- Token exchange failures show the HTTP status and the raw response body in a collapsible "Details" block.
- Never swallow an error. Never fall back to fake data. If there is no data, say so.

### 9. Debug panel

Add a collapsible panel at the bottom of Screen C titled "Debug". It shows:
- `patient` ID from the token response
- `fhirUser` from the ID token
- granted `scope`
- `expires_at` as a readable time
- The token request, under the heading "Token request": method, URL, and HTTP status. It exists only on the page load that handled the login redirect. After a refresh the saved session is reused and no token request is made; in that case show "No token request was made on this page load. The saved session was reused. Disconnect and connect again to see it."
- For each FHIR request made, under the heading "FHIR requests": method, full URL, HTTP status, and number of resources returned. Pagination requests are listed as their own rows.

Each request is a row that expands when clicked. Expanded, it shows three blocks in this order:

1. **Request headers**, exactly as sent, one per line as `Name: value`. For FHIR requests this includes the full `Authorization: Bearer <access_token>` header with the real token. Do not mask or shorten it.
2. **Request body**, exactly as sent. The token request shows its form-encoded body, one parameter per line. A request with no body shows "No request body. GET requests do not send one."
3. **Response body**, as received. If it is JSON, pretty-print it with 2-space indentation. Otherwise show the raw text. Show error bodies too. If no response arrived, show "No response body was received."

**Vitals debug.** The Vitals section, and the full-page vitals view, each have a collapsible block at the bottom titled "Debug: vitals requests". It is separate from the Debug panel and shows:
- Only the requests made for vitals, including pagination requests, as the same expandable rows with the same three blocks. The Debug panel still lists these requests too.
- Under the heading "How the response was grouped": the number of observations returned and the number of vital types they were grouped into, for example "57 observations grouped into 7 vital types."
- A table with one row per vital type that has data: the type name, what it was matched on (`LOINC <codes>` for known types, "code text" for other vitals), the number of readings, the number of readings on the graph, and the unit.
- Show this block even when the vitals request failed, so the failed request and its error body can be inspected. In that case leave out the grouping part.

To support this, give every log entry a `section` field with one of: `token`, `patient`, `conditions`, `medications`, `labs`, `vitals`. Set it where the request is made.

Rules for the log behind this panel:
- Record each entry in the same function that calls `fetch`, and pass the same headers object to `fetch` and to the log, so the panel shows what was really sent.
- Read every response with `response.text()` first, store that text, then parse it with `JSON.parse`. Do not call `response.json()`.
- Keep the log in memory only. Do not write request or response payloads to `sessionStorage`.
- Put each payload in a box with a maximum height and its own scrollbar, so a large Bundle does not stretch the page. Render a payload only while its row is open.

This panel is for learners. It shows the access token and the raw payloads on purpose, so they can see every step. That is acceptable only because the app runs against the Epic sandbox with test patients. Remove the token and the payloads from the panel before using this app with real patient data.

### 10. Things that must not happen

- Do not use the OAuth implicit flow (`response_type=token`).
- Do not put the access token in the URL, in `localStorage`, or in a cookie.
- Do not add a client secret anywhere, including as an environment variable.
- Do not hardcode a client ID anywhere in the source. It comes from `.env` only.
- Do not hardcode a patient ID. It always comes from the token response.
- Do not call `/Medication`. That is the drug catalogue, not the patient's medications.
- Do not call `/Observation` without a `category` parameter.
- Do not fetch `.well-known/smart-configuration` at runtime.
- Do not request scopes not listed in `SCOPES`.
- Do not use `Accept: application/json`. Use `application/fhir+json`.
- Do not use any UI, auth, or FHIR library beyond the dependencies listed in section 1.
- Do not use a chart library. Do not draw a chart with two y axes. Do not convert units.
- Do not generate placeholder or sample clinical data anywhere in the codebase.

### 11. Deliverables

- Full source in a runnable state.
- `README.md` with: how to set `VITE_EPIC_CLIENT_ID`, how to run (`npm install`, `npm run dev`), the exact redirect URI to register (`http://localhost:3000`, no trailing slash), and a note that a newly registered client ID can take up to an hour to work.
- The README must also include this test login for the sandbox: Epic publishes test patient credentials on its sandbox documentation page. One of them is username `fhircamila`, password `epicepic1` (Camila Lopez). Tell the reader to check that page for the current list.

### 12. Acceptance test

The app is done when all of these pass, in order, with a fresh browser session:

1. `npm run dev` starts on `http://localhost:3000/` with no console errors.
2. Screen A shows with the "Connect your health records" button disabled. Clicking "Epic Sandbox (test data)" selects it and stays on Screen A. Clicking "Connect your health records" then redirects to a `fhir.epic.com` URL containing `code_challenge_method=S256` and `aud=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`.
3. After logging in as `fhircamila` and approving, the browser lands on `http://localhost:3000/` with `?code=` and `?state=`, and the query string is removed from the address bar within a second.
4. Screen B shows all six steps completing.
5. Screen C shows a patient banner with a real name and date of birth, at least one condition, at least one medication, at least one lab result with a value and unit, and at least one vital.
6. Refreshing the page keeps Screen C without going back through login.
7. The debug panel lists one token request and five FHIR requests, all with HTTP status 200. Expanding a FHIR request shows the `Authorization: Bearer` header with the token and the JSON response body. Expanding the token request shows the form-encoded request body and the JSON response.
8. The Vitals section shows eight tiles in the fixed order. The first tile with data is selected, and its graph and table show below the tiles. Clicking another tile with data switches the graph and the table. Hovering the graph shows a tooltip with a date and a value. Blood pressure, if present, shows two lines and a legend.
9. "Debug: vitals requests" inside the Vitals section lists only requests whose URL contains `category=vital-signs`, and the grouping table below them matches the tiles.
10. "View more" on the Vitals section opens the full-page vitals view with every vital type that has data, "All time", "Graph" and "All types" selected. Clicking "Table" replaces every graph with a table. Clicking a type in the list shows only that type. Choosing "Custom" and narrowing the dates changes the chip counts and the graph's x axis. Escape and "Close" both return to Screen C with the sections unchanged.
11. "Disconnect" returns to Screen A. Refreshing then stays on Screen A.
12. Manually setting `expires_at` in `sessionStorage` to a past time and refreshing shows Screen A with the session expired message.

If any step fails, fix the app. Do not mark the task complete until all twelve pass.

### 13. Known sandbox behaviours (do not "fix" these)

- The Epic sandbox consent screen may list more data types than the scopes requested. Production shows only the requested scopes.
- A newly registered client ID can return `invalid_client` for up to an hour after registration.
- MyChart shows a warning that the app is not affiliated with the provider and is not covered by HIPAA. This is expected for a sandbox app.
- Some sandbox patients have empty sections. An empty section with "Not recorded" is correct behaviour, not a bug.
- If MyChart shows "The request is invalid" (`error=4` in the URL) before the login form, the `redirect_uri` sent does not match the registered one. The app sends `window.location.origin`, which is `http://localhost:3000` with no trailing slash; register exactly that.
- If the token exchange returns `invalid_grant`, the usual causes are: the redirect URI sent does not exactly match the registered one (check for a stray trailing slash), the code was already used (refresh after callback), or the code verifier does not match the challenge.

