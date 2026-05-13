// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraTicket {
  title: string;
  description: string;
}

export interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
}

// ---------------------------------------------------------------------------
// Slack thread URL parser
// ---------------------------------------------------------------------------

// Parses a Slack thread URL into channel and thread_ts.
// Supports: https://{workspace}.slack.com/archives/{channel}/p{ts_no_dot}
export function parseSlackThreadUrl(input: string): { channel: string; threadTs: string } | null {
  const match = input.match(/slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/i);
  if (!match) return null;
  const channel = match[1];
  const raw = match[2];
  const threadTs = `${raw.slice(0, -6)}.${raw.slice(-6)}`;
  return { channel, threadTs };
}
