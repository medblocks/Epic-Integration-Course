// FHIR HTTP layer. Section 6 of the spec: headers, pagination, Bundle and
// OperationOutcome handling, and HTTP error classification.

import { NetworkError } from "./oauth";
import type {
  AnyResource,
  Bundle,
  OperationOutcome,
  RequestLog,
  RequestSection,
  SectionResult,
} from "./types";

export class FhirHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`FHIR request failed with HTTP ${status}`);
  }
}

// Thrown when a Bundle contains only an OperationOutcome with severity error.
export class OperationOutcomeError extends Error {}

// Thrown on 401. The caller clears the session and returns to Screen A.
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please connect again.");
  }
}

async function fhirGet(
  url: string,
  accessToken: string,
  log: RequestLog[],
  section: RequestSection,
): Promise<unknown> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/fhir+json",
  };
  const entry: RequestLog = {
    section,
    method: "GET",
    url,
    status: "network error",
    count: 0,
    requestHeaders: headers,
    requestBody: null,
    responseBody: null,
  };
  log.push(entry);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers });
  } catch {
    throw new NetworkError();
  }

  entry.status = response.status;
  // Read as text first so the debug panel can show the body exactly as received,
  // including error bodies that are not JSON.
  const text = await response.text();
  entry.responseBody = text;
  if (!response.ok) {
    throw new FhirHttpError(response.status, text);
  }
  const json: unknown = JSON.parse(text);
  entry.count = 1;
  return json;
}

// GET a single resource such as Patient/{id}.
export async function fetchResource<T extends AnyResource>(
  url: string,
  accessToken: string,
  log: RequestLog[],
  section: RequestSection,
): Promise<T> {
  const json = (await fhirGet(url, accessToken, log, section)) as AnyResource;
  if (json.resourceType === "OperationOutcome") {
    throw new OperationOutcomeError(outcomeMessage(json as OperationOutcome));
  }
  return json as T;
}

function outcomeMessage(outcome: OperationOutcome): string {
  const issue = outcome.issue?.[0];
  return issue?.diagnostics ?? issue?.details?.text ?? "The server returned an error.";
}

const MAX_NEXT_LINKS = 5;

// GET a search Bundle, follow "next" links (at most 5), and return resources.
export async function fetchAll<T extends AnyResource>(
  url: string,
  accessToken: string,
  log: RequestLog[],
  section: RequestSection,
): Promise<T[]> {
  const resources: T[] = [];
  const outcomes: OperationOutcome[] = [];
  let nextUrl: string | undefined = url;
  let followed = 0;

  while (nextUrl) {
    const logIndex = log.length;
    const bundle = (await fhirGet(nextUrl, accessToken, log, section)) as Bundle;

    // bundle.entry may be absent. Treat absent as empty.
    const entries = bundle.entry ?? [];
    let pageCount = 0;
    for (const entry of entries) {
      const resource = entry.resource;
      if (!resource) continue;
      if (resource.resourceType === "OperationOutcome") {
        outcomes.push(resource as OperationOutcome);
        continue;
      }
      resources.push(resource as T);
      pageCount++;
    }
    log[logIndex].count = pageCount;

    const next = (bundle.link ?? []).find((l) => l.relation === "next")?.url;
    if (next && followed < MAX_NEXT_LINKS) {
      nextUrl = next;
      followed++;
    } else {
      nextUrl = undefined;
    }
  }

  // An OperationOutcome as the only content with severity error means failure.
  if (resources.length === 0 && outcomes.length > 0) {
    const error = outcomes.find((o) => o.issue?.some((i) => i.severity === "error"));
    if (error) throw new OperationOutcomeError(outcomeMessage(error));
  }

  return resources;
}

// Wraps fetchAll for one Screen C section. 401 propagates as SessionExpiredError
// so the whole page resets; every other failure is contained to the section.
export async function loadSection<T extends AnyResource>(
  url: string,
  accessToken: string,
  log: RequestLog[],
  section: RequestSection,
): Promise<SectionResult<T>> {
  try {
    const resources = await fetchAll<T>(url, accessToken, log, section);
    return { ok: true, resources };
  } catch (error) {
    return { ok: false, ...describeError(error) };
  }
}

// Turns a caught error into a user-facing message plus optional raw detail.
// Rethrows 401 as SessionExpiredError.
export function describeError(error: unknown): { message: string; detail?: string } {
  if (error instanceof FhirHttpError) {
    if (error.status === 401) throw new SessionExpiredError();
    if (error.status === 403) {
      return { message: "Your health system did not grant access to this data type." };
    }
    return { message: `Request failed with HTTP ${error.status}.`, detail: error.body };
  }
  if (error instanceof NetworkError || error instanceof OperationOutcomeError) {
    return { message: error.message };
  }
  if (error instanceof SessionExpiredError) throw error;
  return { message: error instanceof Error ? error.message : "Unexpected error." };
}
