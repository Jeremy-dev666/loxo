const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

/** Slack chat.postMessage caps text well above this; truncate for readability. */
const REPLY_MAX_CHARS = 4000;

export interface PostMessageInput {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string;
}

export interface SlackClient {
  postMessage(input: PostMessageInput): Promise<void>;
}

const webApiClient: SlackClient = {
  async postMessage(input: PostMessageInput): Promise<void> {
    const response = await fetch(POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: input.channel,
        text: truncateReply(input.text),
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error(`Slack chat.postMessage failed: ${payload.error ?? response.status}`);
    }
  },
};

let client: SlackClient = webApiClient;

export function getSlackClient(): SlackClient {
  return client;
}

/** Test seam: capture outgoing messages without calling slack.com. */
export function setSlackClientForTests(override: SlackClient | null): void {
  client = override ?? webApiClient;
}

export function truncateReply(text: string): string {
  if (text.length <= REPLY_MAX_CHARS) return text;
  return `${text.slice(0, REPLY_MAX_CHARS - 60).trimEnd()}\n\n[Truncated — see Loxo for the full output]`;
}
