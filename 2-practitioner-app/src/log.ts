// The in-memory request log behind the FHIR panel. Section 9 of the spec.
// Entries are created by the one function that calls fetch (http.ts) and
// updated in place as the response arrives. React components subscribe
// through useRequestLog, which hands out a fresh snapshot on every change.
// Nothing here is written to sessionStorage, with one exception made in
// oauth.ts: the discovery entry (public endpoint URLs only) is carried across
// the redirect to Epic so the panel can still show it afterwards.

import { useSyncExternalStore } from "react";
import type { RequestLog } from "./types";

const entries: RequestLog[] = [];
let snapshot: RequestLog[] = [];
const listeners = new Set<() => void>();

function bump(): void {
  snapshot = [...entries];
  for (const listener of listeners) listener();
}

export function logRequest(entry: RequestLog): RequestLog {
  entries.push(entry);
  bump();
  return entry;
}

// Call after mutating an entry (status, body) so subscribers re-render.
export function logUpdated(): void {
  bump();
}

// Forgets every request. Used when a session is closed so the next session's
// panel starts empty.
export function clearLog(): void {
  entries.length = 0;
  bump();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRequestLog(): RequestLog[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}
