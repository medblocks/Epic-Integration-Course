# Epic FHIR course

This course has three videos and three apps. All three apps run against Epic's public FHIR sandbox. Each video builds one SMART on FHIR app from a single prompt. Each app has its own folder in this repository, and the prompt sits next to the source. You can follow the video, or you can paste the prompt into a coding agent and build the app yourself.

## Apps

| Folder | App | What it builds | Video |
| --- | --- | --- | --- |
| [1-patient-app](1-patient-app/) | CareSummary | A patient-facing app. The patient logs in with MyChart. The app shows a one-page summary of their conditions, medications, labs, and vitals. The browser does OAuth 2.0 with PKCE by hand, with no OAuth library. | Build a patient app with Epic (link coming) |
| 2-practitioner-app | Coming soon | A clinician-facing app. Epic launches it from inside the clinical workflow. | Build a practitioner app with Epic |
| 3-backend-app | Coming soon | A backend service. It connects to Epic with its own credentials. No user is in the loop. | Build a backend app with Epic |

## What each folder contains

- `README.md`: what the app does, what to register on fhir.epic.com, and how to run the app.
- `PROMPT.md`: the full prompt that built the app. Paste the whole file into a coding agent.
- The source code. Run `npm install` and then `npm run dev` inside the folder.

## Before you start

1. Create a free developer account at https://fhir.epic.com.
2. Register one app per video. The audience, resources, scopes, and redirect URI differ from app to app. Each app's README lists the values to use.
3. Copy the **Non-Production Client ID** from the registration page.
4. Put the client ID in a `.env` file inside the app folder. Each folder has an `.env.example` file to copy. Git ignores `.env`.

A new client ID can take up to one hour to become active. Until then, Epic returns `invalid_client`.

## Test login

Epic publishes test patient credentials on its sandbox documentation page: https://fhir.epic.com/Documentation?docId=testpatients. One of the test patients is Camila Lopez:

- Username: `fhircamila`
- Password: `epicepic1`

The sandbox accounts change over time. Check that page for the current list.

## Known sandbox behaviours

These behaviours apply to every app in the course. Each app's README lists the behaviours that are specific to that app.

- The consent screen can list more data types than the app requested. Production shows only the requested scopes.
- MyChart warns that the app is not affiliated with the provider and that HIPAA does not cover it. This warning is expected for a sandbox app.
- Some sandbox patients have empty sections. In that case, "Not recorded" is correct. It is not a bug.
- A new client ID can return `invalid_client` for up to one hour.

## A note on the debug panels

The apps show access tokens and raw FHIR payloads on screen. This makes every step of the flow visible. That is safe against the sandbox with test patients. Remove those panels before you point any of these apps at real patient data.
