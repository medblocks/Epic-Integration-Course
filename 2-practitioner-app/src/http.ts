// The one place that calls fetch. Every request to Epic goes through here so
// the FHIR panel records exactly what was sent and received. Section 9 rules:
// the same headers object goes to fetch and to the log; the response is read
// with response.text() and parsed only by the caller; the Location header is
// recorded when present.

import { logRequest, logUpdated } from "./log";
import type { RequestLog, RequestSection } from "./types";

export class NetworkError extends Error {
  constructor() {
    super("Could not reach Epic. Check your connection and try again.");
  }
}

export interface EpicResponse {
  status: number;
  text: string;
  location: string | null;
  entry: RequestLog;
}

export async function epicFetch(request: {
  section: RequestSection;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<EpicResponse> {
  const entry = logRequest({
    section: request.section,
    method: request.method,
    url: request.url,
    status: "pending",
    count: null,
    requestHeaders: request.headers,
    requestBody: request.body ?? null,
    responseBody: null,
    responseLocation: null,
  });

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  } catch {
    entry.status = "network error";
    logUpdated();
    throw new NetworkError();
  }

  entry.status = response.status;
  // Read as text first so the panel can show the body exactly as received,
  // including empty bodies and error bodies that are not JSON.
  const text = await response.text();
  entry.responseBody = text;
  entry.responseLocation = response.headers.get("Location");
  logUpdated();

  return { status: response.status, text, location: entry.responseLocation, entry };
}

// JSON.parse only when the text is non-empty. Returns null for an empty body
// or for text that is not JSON.
export function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
