import type { ErrorEvent } from '@sentry/node';
import { isSensitiveKeyName } from '../logging/redaction.js';

const MAX_SCRUB_DEPTH = 6;

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_SCRUB_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  const scrubbed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    scrubbed[key] = isSensitiveKeyName(key) ? '[Redacted]' : scrubValue(entry, depth + 1);
  }
  return scrubbed;
}

// The worker never attaches a job's data to a Sentry event (reportJobFailure
// only sends queue name, job id and attempt number), but this still scrubs
// extra/contexts/breadcrumbs defensively so a future capture site can't leak
// a token, password or secret-shaped field.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.data = undefined;
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers, 0) as Record<string, string>;
    }
  }
  if (event.extra) {
    event.extra = scrubValue(event.extra, 0) as typeof event.extra;
  }
  if (event.contexts) {
    event.contexts = scrubValue(event.contexts, 0) as typeof event.contexts;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) =>
      crumb.data ? { ...crumb, data: scrubValue(crumb.data, 0) as Record<string, unknown> } : crumb,
    );
  }
  return event;
}
