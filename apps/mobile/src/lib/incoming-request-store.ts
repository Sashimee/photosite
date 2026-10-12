import type { components } from '@photoo/api-client';

type RequestSummary = components['schemas']['RequestSummary'];

// `GET /v1/requests/{id}` only resolves for a photographer once they hold a
// quote on the request, so the feed items are the source for the detail screen.
const requests = new Map<string, RequestSummary>();

export function rememberIncomingRequests(items: readonly RequestSummary[]): void {
  for (const item of items) {
    requests.set(item.id, item);
  }
}

export function recallIncomingRequest(id: string): RequestSummary | undefined {
  return requests.get(id);
}

export function clearIncomingRequests(): void {
  requests.clear();
}
