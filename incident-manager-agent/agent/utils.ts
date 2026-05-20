// ---------------------------------------------------------------------------
// Slack helpers
// ---------------------------------------------------------------------------

export function slackHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function createSlackChannel(
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch('https://slack.com/api/conversations.create', {
    method: 'POST',
    headers: slackHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; channel: { id: string; name: string }; error?: string };
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return { id: data.channel.id, name: data.channel.name };
}

export async function joinSlackChannel(token: string, channelId: string): Promise<void> {
  const res = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: slackHeaders(token),
    body: JSON.stringify({ channel: channelId }),
  });
  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
}

export async function inviteToSlackChannel(
  token: string,
  channelId: string,
  userId: string,
): Promise<void> {
  const res = await fetch('https://slack.com/api/conversations.invite', {
    method: 'POST',
    headers: slackHeaders(token),
    body: JSON.stringify({ channel: channelId, users: userId }),
  });
  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
}

export async function getSlackChannelMessages(
  token: string,
  channelId: string,
): Promise<{ ts: string; user: string; text: string }[]> {
  const res = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    messages: { ts: string; user: string; text: string }[];
    error?: string;
  };
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return data.messages;
}
