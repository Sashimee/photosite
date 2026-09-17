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
