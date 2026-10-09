// One App component, three screens, chosen by state. Section 3 and 4.

import { useEffect, useRef, useState } from "react";
import {
  clearSession,
  exchangeCode,
  isSessionValid,
  loadSession,
  NetworkError,
  STATE_KEY,
  TokenExchangeError,
} from "./oauth";
import {
  describeError,
  fetchResource,
  loadSection,
  SessionExpiredError,
} from "./fhir";
import type {
  Condition,
  EpicSession,
  MedicationRequest,
  Observation,
  Patient,
  RequestLog,
  SummaryData,
} from "./types";
import { ConnectScreen, type ConnectError } from "./screens/Connect";
import { LoadingScreen, type LoadError, type StepState, STEP_LABELS } from "./screens/Loading";
import { SummaryScreen } from "./screens/Summary";

type AppState =
  | { screen: "connect"; error: ConnectError | null }
  | { screen: "loading"; steps: StepState[]; error: LoadError | null }
  | {
      screen: "summary";
      session: EpicSession;
      data: SummaryData;
      tokenLog: RequestLog[];
      log: RequestLog[];
    };

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please connect again.";

function initialSteps(): StepState[] {
  return STEP_LABELS.map(() => "pending");
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

  function showConnect(error: ConnectError | null = null) {
    setState({ screen: "connect", error });
  }

  function updateSteps(steps: StepState[], error: LoadError | null = null) {
    setState({ screen: "loading", steps: [...steps], error });
  }

  async function start() {
    const params = new URLSearchParams(window.location.search);

    if (params.has("error")) {
      history.replaceState({}, "", "/");
      showConnect({
        title: params.get("error") ?? "error",
        description: params.get("error_description") ?? undefined,
      });
      return;
    }

    if (params.has("code")) {
      const code = params.get("code") ?? "";
      const urlState = params.get("state");
      const savedState = sessionStorage.getItem(STATE_KEY);
      if (!urlState || !savedState || urlState !== savedState) {
        clearSession();
        history.replaceState({}, "", "/");
        showConnect({ title: "Login could not be verified (state mismatch). Please try again." });
        return;
      }
      // Clear the query string immediately so a refresh does not resend the code.
      history.replaceState({}, "", "/");

      const steps = initialSteps();
      steps[0] = "active";
      updateSteps(steps);

      const tokenLog: RequestLog[] = [];
      let session: EpicSession;
      try {
        session = await exchangeCode(code, tokenLog);
      } catch (error) {
        steps[0] = "failed";
        if (error instanceof TokenExchangeError) {
          updateSteps(steps, {
            message: `Token exchange failed with HTTP ${error.status}.`,
            detail: error.body,
          });
        } else if (error instanceof NetworkError) {
          updateSteps(steps, { message: error.message });
        } else {
          updateSteps(steps, { message: error instanceof Error ? error.message : "Unexpected error." });
        }
        return;
      }
      steps[0] = "done";
      await loadData(session, steps, tokenLog);
      return;
    }

    const session = loadSession();
    if (isSessionValid(session)) {
      const steps = initialSteps();
      steps[0] = "done"; // already logged in; nothing to verify
      // No token request happens on this path, so the token log is empty.
      await loadData(session, steps, []);
      return;
    }
    if (session) {
      // A session exists but is expired or about to expire.
      clearSession();
      showConnect({ title: SESSION_EXPIRED_MESSAGE });
      return;
    }
    showConnect();
  }

  // Section 6: five requests, run sequentially, in this order.
  async function loadData(session: EpicSession, steps: StepState[], tokenLog: RequestLog[]) {
    const log: RequestLog[] = [];
    const base = session.fhir_base_url;
    const id = encodeURIComponent(session.patient);
    const token = session.access_token;

    // Step 1: Patient. This one is essential; if it fails the page cannot be shown.
    steps[1] = "active";
    updateSteps(steps);
    let patient: Patient;
    try {
      patient = await fetchResource<Patient>(`${base}/Patient/${id}`, token, log, "patient");
    } catch (error) {
      steps[1] = "failed";
      try {
        updateSteps(steps, describeError(error));
      } catch (inner) {
        if (inner instanceof SessionExpiredError) {
          clearSession();
          showConnect({ title: SESSION_EXPIRED_MESSAGE });
        }
      }
      return;
    }
    steps[1] = "done";

    // Steps 2-5: each section is loaded independently. A failure in one section
    // is shown inside that section and does not blank the page. Only a 401
    // ends the session.
    const searches: { stepIndex: number; url: string; key: keyof Omit<SummaryData, "patient"> }[] = [
      { stepIndex: 2, key: "conditions", url: `${base}/Condition?patient=${id}&category=problem-list-item` },
      { stepIndex: 3, key: "medications", url: `${base}/MedicationRequest?patient=${id}` },
      { stepIndex: 4, key: "labs", url: `${base}/Observation?patient=${id}&category=laboratory` },
      { stepIndex: 5, key: "vitals", url: `${base}/Observation?patient=${id}&category=vital-signs` },
    ];

    const data: SummaryData = {
      patient,
      conditions: { ok: true, resources: [] },
      medications: { ok: true, resources: [] },
      labs: { ok: true, resources: [] },
      vitals: { ok: true, resources: [] },
    };

    for (const search of searches) {
      steps[search.stepIndex] = "active";
      updateSteps(steps);
      try {
        if (search.key === "conditions") {
          data.conditions = await loadSection<Condition>(search.url, token, log, "conditions");
        } else if (search.key === "medications") {
          data.medications = await loadSection<MedicationRequest>(search.url, token, log, "medications");
        } else if (search.key === "labs") {
          data.labs = await loadSection<Observation>(search.url, token, log, "labs");
        } else {
          data.vitals = await loadSection<Observation>(search.url, token, log, "vitals");
        }
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          clearSession();
          showConnect({ title: SESSION_EXPIRED_MESSAGE });
          return;
        }
        throw error;
      }
      steps[search.stepIndex] = data[search.key].ok ? "done" : "failed";
    }
    updateSteps(steps);

    setState({ screen: "summary", session, data, tokenLog, log });
  }

  function disconnect() {
    clearSession();
    showConnect();
  }

  if (state === null) return null;

  switch (state.screen) {
    case "connect":
      return <ConnectScreen error={state.error} />;
    case "loading":
      return <LoadingScreen steps={state.steps} error={state.error} onStartOver={disconnect} />;
    case "summary":
      return (
        <SummaryScreen
          session={state.session}
          data={state.data}
          tokenLog={state.tokenLog}
          log={state.log}
          onDisconnect={disconnect}
        />
      );
  }
}
