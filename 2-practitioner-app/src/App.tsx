// One App component, three screens, chosen by state. The URL query string and
// sessionStorage decide what happens on load. Sections 3, 4, 5 and 6.

import { useEffect, useRef, useState } from "react";
import { CLIENT_ID } from "./config";
import {
  CreateError,
  createObservation,
  describeError,
  readResource,
  searchAll,
  SessionExpiredError,
  type CreateResult,
} from "./fhir";
import { clearLog } from "./log";
import {
  clearSession,
  deleteLaunchEntry,
  discoverEndpoints,
  exchangeCode,
  isSessionValid,
  LaunchError,
  launchErrorToAppError,
  loadSession,
  NO_CLIENT_ID_MESSAGE,
  normaliseIss,
  readLaunchEntry,
  redirectToEpic,
  restoreDiscoveryLog,
  SESSION_EXPIRED_MESSAGE,
} from "./oauth";
import { ChartScreen } from "./screens/Chart";
import { LaunchScreen } from "./screens/Launch";
import { LaunchingScreen, STEP_LABELS, type StepState } from "./screens/Launching";
import type {
  AppError,
  ChartData,
  Encounter,
  EncounterState,
  MedicationRequest,
  Observation,
  Patient,
  SectionResult,
  Session,
} from "./types";

type AppState =
  | { screen: "launch"; error: AppError | null }
  | { screen: "launching"; steps: StepState[]; notes: (string | null)[]; error: AppError | null }
  | { screen: "chart"; session: Session; data: ChartData; launchedThisLoad: boolean };

// Step indexes into STEP_LABELS.
const STEP = {
  params: 0,
  discover: 1,
  redirect: 2,
  verify: 3,
  patient: 4,
  encounter: 5,
  vitals: 6,
  medications: 7,
} as const;

// Mutable progress for Screen B. Each change is pushed to React state.
class Progress {
  steps: StepState[] = STEP_LABELS.map(() => "pending");
  notes: (string | null)[] = STEP_LABELS.map(() => null);
  constructor(private publish: (p: Progress, error: AppError | null) => void) {}
  active(i: number) {
    this.steps[i] = "active";
    this.publish(this, null);
  }
  done(i: number, note: string | null = null) {
    this.steps[i] = "done";
    this.notes[i] = note;
    this.publish(this, null);
  }
  // A failed step with no error stops nothing: the section shows its own
  // error on Screen C. With an error, Screen B shows it and "Start over".
  failed(i: number, error: AppError | null = null) {
    this.steps[i] = "failed";
    this.publish(this, error);
  }
}

export function App() {
  // Nothing renders until the URL and sessionStorage have been inspected.
  const [state, setState] = useState<AppState | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showLaunch(error: AppError | null = null) {
    setState({ screen: "launch", error });
  }

  function newProgress(): Progress {
    return new Progress((p, error) =>
      setState({ screen: "launching", steps: [...p.steps], notes: [...p.notes], error }),
    );
  }

  // Section 6, 401: clear the session and return to Screen A.
  function expireSession() {
    clearSession();
    showLaunch({ message: SESSION_EXPIRED_MESSAGE });
  }

  function startOver() {
    clearSession();
    clearLog();
    showLaunch();
  }

  // Section 4: the four cases, checked in this order.
  async function start() {
    const params = new URLSearchParams(window.location.search);
    const iss = params.get("iss");
    const launch = params.get("launch");

    // Case 1: EHR launch. A new launch always replaces any saved session.
    if (iss !== null && launch !== null) {
      history.replaceState({}, "", "/");
      await runLaunch(iss, launch, CLIENT_ID);
      return;
    }
    if (iss !== null || launch !== null) {
      history.replaceState({}, "", "/");
      showLaunch({ message: "Incomplete launch. Both iss and launch are required." });
      return;
    }

    // Case 2: Epic sent an OAuth error.
    if (params.has("error")) {
      history.replaceState({}, "", "/");
      const description = params.get("error_description");
      showLaunch({
        message: `${params.get("error")}${description ? `: ${description}` : ""}`,
      });
      return;
    }

    // Case 3: the redirect back from Epic.
    if (params.has("code")) {
      await handleCallback(params.get("code") ?? "", params.get("state") ?? "");
      return;
    }

    // Case 4: no query string. A valid saved session goes straight to the chart.
    const saved = loadSession();
    if (isSessionValid(saved)) {
      await loadChart(saved, false, null);
    } else if (saved) {
      expireSession();
    } else {
      showLaunch();
    }
  }

  // Steps 1 to 3, for an EHR launch and for the manual launch form alike.
  // Ends by navigating the window to Epic, or by showing the failed step.
  async function runLaunch(issRaw: string, launch: string, clientId: string) {
    const progress = newProgress();
    let step: number = STEP.params;
    progress.active(step);
    try {
      if (clientId.trim() === "") throw new LaunchError(NO_CLIENT_ID_MESSAGE);
      const iss = normaliseIss(issRaw);
      progress.done(step);

      step = STEP.discover;
      progress.active(step);
      const endpoints = await discoverEndpoints(iss);
      progress.done(step);

      step = STEP.redirect;
      progress.active(step);
      await redirectToEpic({ iss, launch, clientId: clientId.trim(), endpoints });
      // The window is now navigating to Epic. The step stays active.
    } catch (error) {
      progress.failed(step, launchErrorToAppError(error));
    }
  }

  // Section 4, callback, and section 5, token exchange.
  async function handleCallback(code: string, state: string) {
    // Clear the query string at once, so a refresh does not resend a used code.
    history.replaceState({}, "", "/");

    const progress = newProgress();
    progress.done(STEP.params);
    progress.done(STEP.discover);
    progress.done(STEP.redirect);
    progress.active(STEP.verify);

    const entry = state ? readLaunchEntry(state) : null;
    if (state) restoreDiscoveryLog(state);
    if (!entry) {
      progress.failed(STEP.verify, {
        message: "Launch could not be verified (unknown state). Start the launch again from Epic.",
      });
      return;
    }

    let session: Session;
    try {
      session = await exchangeCode(code, entry);
    } catch (error) {
      progress.failed(STEP.verify, launchErrorToAppError(error));
      return;
    } finally {
      // Deleted whether the exchange succeeded or failed.
      deleteLaunchEntry(state);
    }
    progress.done(STEP.verify);

    await loadChart(session, true, progress);
  }

  // Section 6: the four reads, in order, one at a time, so failures are
  // attributable. A failed section does not stop the others; only a 401 does.
  async function loadChart(session: Session, launchedThisLoad: boolean, given: Progress | null) {
    const progress = given ?? newProgress();
    if (!given) {
      // A refresh with a saved session: there was no launch and no token
      // exchange on this page load, so the first four steps show as done.
      for (const i of [STEP.params, STEP.discover, STEP.redirect, STEP.verify]) progress.done(i);
    }

    try {
      progress.active(STEP.patient);
      const patient = await loadSection<Patient>(() =>
        readResource<Patient>(session, `Patient/${session.patient}`, "patient"),
      );
      patient.ok ? progress.done(STEP.patient) : progress.failed(STEP.patient);

      progress.active(STEP.encounter);
      let encounter: EncounterState;
      if (session.encounter === null) {
        encounter = { kind: "none" };
        progress.done(STEP.encounter, "no encounter in this launch");
      } else {
        const result = await loadSection<Encounter>(() =>
          readResource<Encounter>(session, `Encounter/${session.encounter}`, "encounter"),
        );
        if (result.ok) {
          encounter = { kind: "loaded", resource: result.data };
          progress.done(STEP.encounter);
        } else {
          encounter = { kind: "failed", id: session.encounter, error: result.error };
          progress.failed(STEP.encounter);
        }
      }

      progress.active(STEP.vitals);
      const vitals = await loadVitals(session);
      vitals.ok ? progress.done(STEP.vitals) : progress.failed(STEP.vitals);

      progress.active(STEP.medications);
      const medications = await loadSection<MedicationRequest[]>(() =>
        searchAll<MedicationRequest>(
          session,
          `${session.fhir_base_url}/MedicationRequest?patient=${encodeURIComponent(session.patient)}`,
          "medications",
        ),
      );
      medications.ok ? progress.done(STEP.medications) : progress.failed(STEP.medications);

      setState({
        screen: "chart",
        session,
        data: { patient, encounter, vitals, medications },
        launchedThisLoad,
      });
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        expireSession();
        return;
      }
      throw error;
    }
  }

  // Runs one read and contains its failure. A 401 escapes as SessionExpiredError.
  async function loadSection<T>(run: () => Promise<T>): Promise<SectionResult<T>> {
    try {
      return { ok: true, data: await run() };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  // Request 3, also used for the re-fetch after a write. Epic requires the
  // category parameter on Observation searches.
  function loadVitals(session: Session): Promise<SectionResult<Observation[]>> {
    return loadSection<Observation[]>(() =>
      searchAll<Observation>(
        session,
        `${session.fhir_base_url}/Observation?patient=${encodeURIComponent(session.patient)}&category=vital-signs`,
        "vitals",
      ),
    );
  }

  // Section 7, the write. A 401 ends the session like any other request.
  async function saveReading(session: Session, body: Record<string, unknown>): Promise<CreateResult> {
    try {
      return await createObservation(session, body);
    } catch (error) {
      if (error instanceof CreateError && error.status === 401) expireSession();
      throw error;
    }
  }

  // After a successful write: run request 3 again and replace the vitals in
  // memory. The new reading comes from Epic's response, not from local state.
  async function refreshVitals(session: Session) {
    try {
      const vitals = await loadVitals(session);
      setState((current) =>
        current?.screen === "chart" ? { ...current, data: { ...current.data, vitals } } : current,
      );
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        expireSession();
        return;
      }
      throw error;
    }
  }

  if (state === null) return null;

  switch (state.screen) {
    case "launch":
      return (
        <LaunchScreen
          error={state.error}
          onLaunch={(fhirBaseUrl, clientId, launchToken) =>
            void runLaunch(fhirBaseUrl, launchToken, clientId)
          }
        />
      );
    case "launching":
      return (
        <LaunchingScreen
          steps={state.steps}
          notes={state.notes}
          error={state.error}
          onStartOver={startOver}
        />
      );
    case "chart":
      return (
        <ChartScreen
          session={state.session}
          data={state.data}
          launchedThisLoad={state.launchedThisLoad}
          onClose={startOver}
          onSave={(body) => saveReading(state.session, body)}
          onRefreshVitals={() => refreshVitals(state.session)}
        />
      );
  }
}
