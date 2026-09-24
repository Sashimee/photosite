// Focused port of apps/api/src/testing/mailpit.ts's waitForLinkInEmail:
// apps/web should not reach into apps/api/src/testing across the app
// boundary, and tests/smoke's own auth.setup.ts already sets the precedent
// of re-implementing a small piece of proven mechanics locally rather than
// importing it. Keep both copies in sync by hand if Mailpit's API changes.
const MAILPIT_BASE_URL = 'http://127.0.0.1:8025';

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
}

interface MailpitSearchResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
  HTML: string;
}

async function searchMessagesTo(to: string): Promise<MailpitMessageSummary[]> {
  const response = await fetch(
    `${MAILPIT_BASE_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
  );
  const body = (await response.json()) as MailpitSearchResponse;
  return body.messages;
}

async function fetchMessage(id: string): Promise<MailpitMessage> {
  const response = await fetch(`${MAILPIT_BASE_URL}/api/v1/message/${id}`);
  return (await response.json()) as MailpitMessage;
}

// #288: a Mailpit timeout with no named cause was once misread as a
// 409-vs-400 bug in an unrelated subsystem, three diagnosis passes later.
export async function waitForLinkInEmail(
  to: string,
  linkPattern: RegExp,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await searchMessagesTo(to);
    for (const summary of messages) {
      const message = await fetchMessage(summary.ID);
      const match = linkPattern.exec(message.Text) ?? linkPattern.exec(message.HTML);
      if (match?.[0]) {
        return match[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `mailpit: no message to ${to} matched ${linkPattern.toString()} within ${String(timeoutMs)}ms`,
  );
}
