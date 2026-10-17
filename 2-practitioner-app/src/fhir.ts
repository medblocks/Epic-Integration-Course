// FHIR HTTP layer. Section 6 of the spec: headers, pagination, Bundle and
// OperationOutcome handling, HTTP error classification, and the write.

import { epicFetch, NetworkError, parseJson } from "./http";
import { SESSION_EXPIRED_MESSAGE } from "./oauth";
import type {
  AnyResource,
  AppError,
  Bundle,
  OperationOutcome,
  RequestSection,
  Session,
} from "./types";

export class FhirHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Request failed with HTTP ${status}.`);
  }
}

// Thrown when a response is an OperationOutcome with severity error.
export class OperationOutcomeError extends Error {}

// Thrown on 401. The caller clears the session and returns to Screen A.
export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
  }
}

// Every read uses these two headers and nothing else.
function readHeaders(session: Session): Record<string, string> {
  return {
    Authorization: `Bearer ${session.access_token}`,
    Accept: "application/fhir+json",
  };
}

export function outcomeMessage(outcome: OperationOutcome): string {
  const issue = outcome.issue?.[0];
  return issue?.diagnostics ?? issue?.details?.text ?? "Epic returned an error.";
}

function isOutcome(resource: unknown): resource is OperationOutcome {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as { resourceType?: string }).resourceType === "OperationOutcome"
  );
}

// GET a single resource such as Patient/{id}. Not a Bundle.
export async function readResource<T extends AnyResource>(
  session: Session,
  path: string,
  section: RequestSection,
): Promise<T> {
  const response = await epicFetch({
    section,
    method: "GET",
    url: `${session.fhir_base_url}/${path}`,
    headers: readHeaders(session),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new FhirHttpError(response.status, response.text);
  }
  const json = parseJson(response.text);
  if (isOutcome(json)) throw new OperationOutcomeError(outcomeMessage(json));
  if (!json) throw new FhirHttpError(response.status, response.text);
  return json as T;
}

const MAX_NEXT_LINKS = 5;

// GET a search Bundle, follow "next" links (at most 5), and return the
// resources. Each page is its own row in the FHIR panel.
export async function searchAll<T extends AnyResource>(
  session: Session,
  url: string,
  section: RequestSection,
): Promise<T[]> {
  const resources: T[] = [];
  const outcomes: OperationOutcome[] = [];
  let nextUrl: string | undefined = url;
  let followed = 0;

  while (nextUrl) {
    const response = await epicFetch({
      section,
      method: "GET",
      url: nextUrl,
      headers: readHeaders(session),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new FhirHttpError(response.status, response.text);
    }
    const json = parseJson(response.text);
    if (isOutcome(json)) throw new OperationOutcomeError(outcomeMessage(json));
    const bundle = (json ?? {}) as Bundle;

    // bundle.entry may be absent. Treat absent as empty.
    let pageCount = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      if (isOutcome(resource)) {
        outcomes.push(resource);
        continue;
      }
      resources.push(resource as T);
      pageCount++;
    }
    response.entry.count = pageCount;

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

export interface CreateResult {
  status: number;
  // The new resource's ID, read from the Location header when present.
  newId: string | null;
}

// Thrown when a create returns a non-2xx status. `outcomeText` is the
// OperationOutcome message when the body held one.
export class CreateError extends Error {
  constructor(
    public status: number,
    public body: string,
    public outcomeText: string | null,
  ) {
    super(`Epic rejected the reading with HTTP ${status}.`);
  }
}

// POST {base}/Observation. Any 2xx is success, even with an empty body.
export async function createObservation(
  session: Session,
  body: Record<string, unknown>,
): Promise<CreateResult> {
  const headers = {
    ...readHeaders(session),
    "Content-Type": "application/fhir+json",
  };
  const response = await epicFetch({
    section: "create",
    method: "POST",
    url: `${session.fhir_base_url}/Observation`,
    headers,
    body: JSON.stringify(body),
  });

  if (response.status < 200 || response.status >= 300) {
    const json = parseJson(response.text);
    throw new CreateError(
      response.status,
      response.text,
      isOutcome(json) ? outcomeMessage(json) : null,
    );
  }

  const match = /\/Observation\/([^/?#]+)/.exec(response.location ?? "");
  return { status: response.status, newId: match ? match[1] : null };
}

// Turns a caught error into a user-facing message plus optional raw detail.
// 401 is rethrown as SessionExpiredError so the whole page resets; every
// other failure stays inside its section.
export function describeError(error: unknown): AppError {
  if (error instanceof FhirHttpError) {
    if (error.status === 401) throw new SessionExpiredError();
    if (error.status === 403) {
      return { message: "Epic did not grant access to this data type." };
    }
    return { message: error.message, detail: error.body };
  }
  if (error instanceof NetworkError || error instanceof OperationOutcomeError) {
    return { message: error.message };
  }
  if (error instanceof SessionExpiredError) throw error;
  return { message: error instanceof Error ? error.message : "Unexpected error." };
}
