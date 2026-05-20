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
    { headers: slackHeaders(token) },
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

// ---------------------------------------------------------------------------
// Notion shared types
// ---------------------------------------------------------------------------

export interface IncidentRecord {
  page_id: string;
  name: string;
  status: string;
  severity_level: string;
  incident_date: string;
  slack_channel_id: string;
}

export interface CreateIncidentData {
  name: string;
  incident_date: string;
  status: string;
  severity_level: string;
  detail_summary: string;
  engineering_update: string;
  support_update: string;
  slack_channel_id: string;
}

export interface UpdateIncidentData {
  status: string;
  severity_level: string;
  detail_summary: string;
  engineering_update: string;
  support_update: string;
}

interface NotionPage {
  id: string;
  properties: {
    Name?: { title: { plain_text: string }[] };
    Status?: { select: { name: string } };
    'Severity Level'?: { select: { name: string } };
    'Incident Date'?: { date: { start: string } };
    'Slack Channel ID'?: { rich_text: { plain_text: string }[] };
  };
}

// ---------------------------------------------------------------------------
// Notion helpers
// ---------------------------------------------------------------------------

export function notionHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
}

export async function fetchIncidentsFromNotion(
  apiKey: string,
  databaseId: string,
): Promise<IncidentRecord[]> {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  const data = (await res.json()) as { results: NotionPage[] };
  return data.results.map((page) => ({
    page_id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text ?? '',
    status: page.properties.Status?.select?.name ?? '',
    severity_level: page.properties['Severity Level']?.select?.name ?? '',
    incident_date: page.properties['Incident Date']?.date?.start ?? '',
    slack_channel_id: page.properties['Slack Channel ID']?.rich_text?.[0]?.plain_text ?? '',
  }));
}

function buildSummaryBlocks(
  detailSummary: string,
  engineeringUpdate: string,
  supportUpdate: string,
): object[] {
  return [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Detail Summary' } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: detailSummary } }] } },
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Engineering Update' } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: engineeringUpdate } }] } },
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Support Update' } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: supportUpdate } }] } },
  ];
}

export async function createIncidentInNotion(
  apiKey: string,
  databaseId: string,
  data: CreateIncidentData,
): Promise<{ page_id: string }> {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: data.name } }] },
        'Incident Date': { date: { start: data.incident_date } },
        Status: { select: { name: data.status } },
        'Severity Level': { select: { name: data.severity_level } },
        'Slack Channel ID': { rich_text: [{ text: { content: data.slack_channel_id } }] },
      },
      children: buildSummaryBlocks(data.detail_summary, data.engineering_update, data.support_update),
    }),
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  const page = (await res.json()) as { id: string };
  return { page_id: page.id };
}

export async function updateIncidentInNotion(
  apiKey: string,
  pageId: string,
  data: UpdateIncidentData,
): Promise<{ page_id: string }> {
  // Update page properties
  const propsRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      properties: {
        Status: { select: { name: data.status } },
        'Severity Level': { select: { name: data.severity_level } },
      },
    }),
  });
  if (!propsRes.ok) throw new Error(`Notion API error: ${propsRes.status}`);

  // Fetch existing child blocks
  const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    headers: notionHeaders(apiKey),
  });
  if (!blocksRes.ok) throw new Error(`Notion API error: ${blocksRes.status}`);
  const blocksData = (await blocksRes.json()) as { results: { id: string }[] };

  // Archive existing blocks
  await Promise.all(
    blocksData.results.map((block) =>
      fetch(`https://api.notion.com/v1/blocks/${block.id}`, {
        method: 'PATCH',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({ archived: true }),
      }),
    ),
  );

  // Append fresh summary blocks
  const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      children: buildSummaryBlocks(data.detail_summary, data.engineering_update, data.support_update),
    }),
  });
  if (!appendRes.ok) throw new Error(`Notion API error: ${appendRes.status}`);

  return { page_id: pageId };
}
