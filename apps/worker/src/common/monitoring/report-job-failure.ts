import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

export function isFinalAttempt(job: Job): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= attempts;
}

// BullMQ retries a failing job several times before giving up; reporting
// every one of those to Sentry would be noise (and a job that then succeeds
// never needed an alert at all). Only the final, exhausted attempt becomes
// an event - the earlier ones are recorded as a breadcrumb instead, so the
// eventual event still carries the retry history. Job data is never
// attached: it carries ids that map to people.
export function reportJobFailure(queueName: string, job: Job | undefined, error: Error): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  const final = job !== undefined && isFinalAttempt(job);

  Sentry.addBreadcrumb({
    category: 'bullmq',
    level: final ? 'error' : 'warning',
    message: `${queueName} job failed`,
    data: { jobId: job?.id, attemptsMade: job?.attemptsMade },
  });

  if (!final) {
    return;
  }

  Sentry.captureException(error, {
    tags: { queue: queueName },
    extra: { jobId: job.id, attemptsMade: job.attemptsMade },
  });
}
