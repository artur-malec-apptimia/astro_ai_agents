# Incident Manager Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Astropods agent that receives Slack webhook events, manages incident channels, and keeps a Notion incident database updated with AI-generated summaries.

**Architecture:** Bun webhook server on port 3000 responds immediately to Slack (Slack requires <3s response), processes async via GPT-4.1 agentic loop. Astropods adapter for web/Slack chat testing. Pure Slack and Notion API helpers in `utils.ts`, tested with bun:test + mocked `fetch`.

**Tech Stack:** Bun, TypeScript, OpenAI SDK (`gpt-4.1`), `@astropods/adapter-core`, bun:test, native `fetch`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `incident-manager-agent/package.json` | Create | Dependencies, scripts |
| `incident-manager-agent/tsconfig.json` | Create | TypeScript config |
| `incident-manager-agent/Dockerfile` | Create | Container build |
| `incident-manager-agent/.gitignore` | Create | Ignore node_modules, .env |
| `incident-manager-agent/agent/utils.ts` | Create | Slack + Notion API helpers, shared types |
| `incident-manager-agent/agent/utils.test.ts` | Create | Unit tests for all helpers |
| `incident-manager-agent/agent/index.ts` | Create | TOOLS, system prompt, agentic loop, webhook server, adapter |
| `incident-manager-agent/astropods.yml` | Create | Astropods config |
| `incident-manager-agent/AGENT.md` | Create | Usage docs |

---

## Task 1: Scaffold boilerplate files

**Files:**
- Create: `incident-manager-agent/package.json`
- Create: `incident-manager-agent/tsconfig.json`
- Create: `incident-manager-agent/Dockerfile`
- Create: `incident-manager-agent/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "incident-manager-agent",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "bun run agent/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "openai": "^4.0.0",
    "@astropods/adapter-core": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["agent/**/*.ts"]
}
```

- [ ] **Step 3: Create Dockerfile**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/package.json ./
EXPOSE 3000
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "agent/index.ts"]
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.env
.env.local
.ast/
.claude/
```

- [ ] **Step 5: Install dependencies**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun install
```

Expected: packages installed, `node_modules/` created.

- [ ] **Step 6: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/package.json incident-manager-agent/tsconfig.json incident-manager-agent/Dockerfile incident-manager-agent/.gitignore && git commit -m "scaffold incident-manager-agent boilerplate"
```

---

## Task 2: Create Slack helpers in utils.ts (TDD)

**Files:**
- Create: `incident-manager-agent/agent/utils.test.ts` (Slack tests)
- Create: `incident-manager-agent/agent/utils.ts` (Slack helpers)

- [ ] **Step 1: Create utils.test.ts with Slack tests**

```typescript
import { describe, expect, test, spyOn, afterEach } from 'bun:test';
import {
  slackHeaders,
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
} from './utils';

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies.length = 0;
});

describe('slackHeaders', () => {
  test('returns correct Authorization header', () => {
    const headers = slackHeaders('xoxb-test-token');
    expect(headers.Authorization).toBe('Bearer xoxb-test-token');
  });

  test('returns Content-Type application/json', () => {
    const headers = slackHeaders('token');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('createSlackChannel', () => {
  test('POSTs to conversations.create', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    await createSlackChannel('token', 'incident-db-down');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.create',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel name in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    await createSlackChannel('token', 'incident-db-down');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'incident-db-down' });
  });

  test('returns id and name', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    const result = await createSlackChannel('token', 'incident-db-down');
    expect(result).toEqual({ id: 'C123', name: 'incident-db-down' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'name_taken' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(createSlackChannel('token', 'taken')).rejects.toThrow('name_taken');
  });
});

describe('joinSlackChannel', () => {
  test('POSTs to conversations.join', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await joinSlackChannel('token', 'C123');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.join',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel id in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await joinSlackChannel('token', 'C123');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C123' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(joinSlackChannel('token', 'bad')).rejects.toThrow('channel_not_found');
  });
});

describe('inviteToSlackChannel', () => {
  test('POSTs to conversations.invite', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await inviteToSlackChannel('token', 'C123', 'U456');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.invite',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel and users in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await inviteToSlackChannel('token', 'C123', 'U456');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C123', users: 'U456' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'already_in_channel' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(inviteToSlackChannel('token', 'C123', 'U456')).rejects.toThrow('already_in_channel');
  });
});

describe('getSlackChannelMessages', () => {
  test('GETs conversations.history with channel param', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: [] }), { status: 200 }),
    );
    spies.push(spy);
    await getSlackChannelMessages('token', 'C123');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.history?channel=C123',
      expect.anything(),
    );
  });

  test('returns array of messages', async () => {
    const msgs = [{ ts: '1234.5678', user: 'U1', text: 'DB is down' }];
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: msgs }), { status: 200 }),
    );
    spies.push(spy);
    const result = await getSlackChannelMessages('token', 'C123');
    expect(result).toEqual(msgs);
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(getSlackChannelMessages('token', 'C123')).rejects.toThrow('not_in_channel');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: errors about missing `./utils` module.

- [ ] **Step 3: Create utils.ts with Slack helpers**

```typescript
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
```

- [ ] **Step 4: Run tests — verify Slack tests pass**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `14 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/agent/utils.ts incident-manager-agent/agent/utils.test.ts && git commit -m "add Slack helpers and tests for incident-manager-agent"
```

---

## Task 3: Add Notion helpers to utils.ts (TDD)

**Files:**
- Modify: `incident-manager-agent/agent/utils.test.ts` (append Notion tests)
- Modify: `incident-manager-agent/agent/utils.ts` (append Notion helpers)

- [ ] **Step 1: Append Notion tests to utils.test.ts**

Read the current file first. Then make two changes:

**Change 1:** Replace the existing import from `'./utils'` at the top of the file with one that includes the Notion functions:

```typescript
import {
  slackHeaders,
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
  notionHeaders,
  fetchIncidentsFromNotion,
  createIncidentInNotion,
  updateIncidentInNotion,
} from './utils';
```

**Change 2:** Append these describe blocks after the last existing test block:

```typescript
describe('notionHeaders', () => {
  test('returns correct Authorization header', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers.Authorization).toBe('Bearer secret_abc');
  });

  test('returns Notion-Version header', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers['Notion-Version']).toBe('2022-06-28');
  });

  test('returns Content-Type application/json', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('fetchIncidentsFromNotion', () => {
  test('POSTs to the database query endpoint', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    spies.push(spy);
    await fetchIncidentsFromNotion('secret_abc', 'db-123');
    expect(spy).toHaveBeenCalledWith(
      'https://api.notion.com/v1/databases/db-123/query',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('maps results to IncidentRecord array', async () => {
    const mockPage = {
      id: 'page-1',
      properties: {
        Name: { title: [{ plain_text: 'DB Outage' }] },
        Status: { select: { name: 'In progress' } },
        'Severity Level': { select: { name: 'Critical' } },
        'Incident Date': { date: { start: '2026-05-20' } },
        'Slack Channel ID': { rich_text: [{ plain_text: 'C123456' }] },
      },
    };
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [mockPage] }), { status: 200 }),
    );
    spies.push(spy);
    const result = await fetchIncidentsFromNotion('secret_abc', 'db-123');
    expect(result).toEqual([
      {
        page_id: 'page-1',
        name: 'DB Outage',
        status: 'In progress',
        severity_level: 'Critical',
        incident_date: '2026-05-20',
        slack_channel_id: 'C123456',
      },
    ]);
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    spies.push(spy);
    await expect(fetchIncidentsFromNotion('bad', 'db')).rejects.toThrow('401');
  });
});

describe('createIncidentInNotion', () => {
  test('POSTs to /v1/pages', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'new-page-id' }), { status: 200 }),
    );
    spies.push(spy);
    await createIncidentInNotion('secret', 'db-123', {
      name: 'DB Outage',
      incident_date: '2026-05-20',
      status: 'In progress',
      severity_level: 'Critical',
      detail_summary: 'DB is down',
      engineering_update: 'Investigating',
      support_update: 'Users affected',
      slack_channel_id: 'C123',
    });
    expect(spy).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('returns page_id from response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'new-page-id' }), { status: 200 }),
    );
    spies.push(spy);
    const result = await createIncidentInNotion('secret', 'db-123', {
      name: 'DB Outage',
      incident_date: '2026-05-20',
      status: 'In progress',
      severity_level: 'Critical',
      detail_summary: 'DB is down',
      engineering_update: 'Investigating',
      support_update: 'Users affected',
      slack_channel_id: 'C123',
    });
    expect(result).toEqual({ page_id: 'new-page-id' });
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Bad Request', { status: 400 }),
    );
    spies.push(spy);
    await expect(
      createIncidentInNotion('secret', 'db', {
        name: 'x', incident_date: '2026-05-20', status: 'In progress',
        severity_level: 'Low', detail_summary: 'x', engineering_update: 'x',
        support_update: 'x', slack_channel_id: 'C1',
      }),
    ).rejects.toThrow('400');
  });
});

describe('updateIncidentInNotion', () => {
  test('PATCHes the page properties', async () => {
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    await updateIncidentInNotion('secret', 'page-1', {
      status: 'Done',
      severity_level: 'High',
      detail_summary: 'Resolved',
      engineering_update: 'Fixed',
      support_update: 'All clear',
    });
    const [firstUrl, firstInit] = spy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe('https://api.notion.com/v1/pages/page-1');
    expect((firstInit as RequestInit).method).toBe('PATCH');
  });

  test('returns page_id', async () => {
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    const result = await updateIncidentInNotion('secret', 'page-1', {
      status: 'Done',
      severity_level: 'High',
      detail_summary: 'Resolved',
      engineering_update: 'Fixed',
      support_update: 'All clear',
    });
    expect(result).toEqual({ page_id: 'page-1' });
  });
});
```

- [ ] **Step 2: Run tests — verify Notion tests fail**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: Notion tests fail (functions not exported yet), Slack tests still pass.

- [ ] **Step 3: Append Notion helpers to utils.ts**

Read the current file first, then append after the last Slack function:

```typescript
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
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `25 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/agent/utils.ts incident-manager-agent/agent/utils.test.ts && git commit -m "add Notion helpers and tests for incident-manager-agent"
```

---

## Task 4: Create index.ts — imports, env guards, and tool wrappers

**Files:**
- Create: `incident-manager-agent/agent/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
import { serve, type AgentAdapter, type StreamHooks, type StreamOptions } from '@astropods/adapter-core';
import OpenAI from 'openai';
import {
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
  fetchIncidentsFromNotion,
  createIncidentInNotion,
  updateIncidentInNotion,
  type CreateIncidentData,
  type UpdateIncidentData,
} from './utils';

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

function slackToken(): string {
  if (!process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is not set');
  return process.env.SLACK_BOT_TOKEN;
}

function notionApiKey(): string {
  if (!process.env.NOTION_API_KEY) throw new Error('NOTION_API_KEY is not set');
  return process.env.NOTION_API_KEY;
}

function notionDatabaseId(): string {
  if (!process.env.NOTION_DATABASE_ID) throw new Error('NOTION_DATABASE_ID is not set');
  return process.env.NOTION_DATABASE_ID;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolCreateAndJoinSlackChannel(
  channelName: string,
  userId: string,
): Promise<unknown> {
  const channel = await createSlackChannel(slackToken(), channelName);
  await joinSlackChannel(slackToken(), channel.id);
  await inviteToSlackChannel(slackToken(), channel.id, userId);
  return channel;
}

async function toolGetSlackChannelMessages(channelId: string): Promise<unknown> {
  return getSlackChannelMessages(slackToken(), channelId);
}

async function toolFetchListOfIncidentsFromNotion(): Promise<unknown> {
  return fetchIncidentsFromNotion(notionApiKey(), notionDatabaseId());
}

async function toolCreateNewIncidentInNotion(
  input: Record<string, unknown>,
): Promise<unknown> {
  const data: CreateIncidentData = {
    name: input.name as string,
    incident_date: input.incident_date as string,
    status: input.status as string,
    severity_level: input.severity_level as string,
    detail_summary: input.detail_summary as string,
    engineering_update: input.engineering_update as string,
    support_update: input.support_update as string,
    slack_channel_id: input.slack_channel_id as string,
  };
  return createIncidentInNotion(notionApiKey(), notionDatabaseId(), data);
}

async function toolUpdateNotionIncidentPage(
  input: Record<string, unknown>,
): Promise<unknown> {
  const data: UpdateIncidentData = {
    status: input.status as string,
    severity_level: input.severity_level as string,
    detail_summary: input.detail_summary as string,
    engineering_update: input.engineering_update as string,
    support_update: input.support_update as string,
  };
  return updateIncidentInNotion(notionApiKey(), input.page_id as string, data);
}
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `25 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/agent/index.ts && git commit -m "add imports, env guards, and tool wrappers for incident-manager-agent"
```

---

## Task 5: Add TOOLS array, system prompt, and agentic loop to index.ts

**Files:**
- Modify: `incident-manager-agent/agent/index.ts`

- [ ] **Step 1: Append TOOLS array and system prompt after the tool wrappers**

Read the current file, then append:

```typescript
// ---------------------------------------------------------------------------
// OpenAI tool definitions
// ---------------------------------------------------------------------------

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_and_join_slack_channel',
      description:
        'Creates a new Slack channel for the incident, adds the bot, and invites the triggering user.',
      parameters: {
        type: 'object',
        properties: {
          channel_name: {
            type: 'string',
            description: 'Channel name (lowercase, no spaces, use hyphens e.g. incident-db-down)',
          },
          user_id: {
            type: 'string',
            description: 'Slack user ID of the person who triggered the slash command',
          },
        },
        required: ['channel_name', 'user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_slack_channel_messages',
      description: 'Fetches all messages from a Slack incident channel to understand the full context.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Slack channel ID' },
        },
        required: ['channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_list_of_incidents_from_notion',
      description: 'Fetches all existing incidents from the Notion database to find matching or existing ones.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_new_incident_in_notion',
      description: 'Creates a new incident page in the Notion database with status, severity, and summaries.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Incident name' },
          incident_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          status: { type: 'string', description: 'One of: Not started, In progress, Done' },
          severity_level: { type: 'string', description: 'One of: Critical, High, Medium, Low' },
          detail_summary: { type: 'string', description: 'Detailed incident overview with timestamp' },
          engineering_update: { type: 'string', description: 'Technical summary for engineering teams with timestamp' },
          support_update: { type: 'string', description: 'Support-friendly update for external comms with timestamp' },
          slack_channel_id: { type: 'string', description: 'Slack channel ID for this incident' },
        },
        required: [
          'name', 'incident_date', 'status', 'severity_level',
          'detail_summary', 'engineering_update', 'support_update', 'slack_channel_id',
        ],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_notion_incident_page',
      description: 'Updates an existing Notion incident page with latest status, severity, and summaries.',
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: 'Notion page ID of the incident to update' },
          status: { type: 'string', description: 'One of: Not started, In progress, Done' },
          severity_level: { type: 'string', description: 'One of: Critical, High, Medium, Low' },
          detail_summary: { type: 'string', description: 'Detailed incident overview with timestamp' },
          engineering_update: { type: 'string', description: 'Technical summary for engineering teams with timestamp' },
          support_update: { type: 'string', description: 'Support-friendly update for external comms with timestamp' },
        },
        required: ['page_id', 'status', 'severity_level', 'detail_summary', 'engineering_update', 'support_update'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are responsible for managing an ongoing incident. A slash command from Slack will trigger the incident, use the command text to create a channel for the user. Do nothing else for this step scenario.

You will also receive slack events that aren't a slash command. Check for the presence of the "command" field to decide.

Don't rely on the text of the event, ensure you understand the full context by pulling all the messages in the incident channel.

When you receive these events, check if the current incident matches an existing incident or if a new one needs to be created, take into account timestamps for this.

When you receive events for the messages that aren't a slash command, decide whether the incident notes or summaries need to be updated. Make sure you actually have some useful info, don't just update it with filler info. Don't make a new channel for message events that aren't a slash command.

acceptable incident_status (one of: Not started, In progress, Done), and severity_level (one of Critical, High, Medium, Low)

You will provide a detail summary, an update for engineering teams, and an update for supports teams that will be as of the current timestamp.

Summary timestamps only should be in the format: yyyy-mm-dd hh:mm am/pm very human readable.

Once an incident is resolved feel free to close it and you don't need to make further updates unless they warrant reopening the incident.`;

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

async function runAgentLoop(payload: unknown, hooks: StreamHooks): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      max_tokens: 2048,
      tools: TOOLS,
      messages,
    });

    const message = response.choices[0].message;

    if (message.content) {
      await hooks.onChunk(message.content);
    }

    if (response.choices[0].finish_reason === 'stop') break;

    if (response.choices[0].finish_reason === 'tool_calls') {
      messages.push(message);

      for (const toolCall of message.tool_calls ?? []) {
        const name = toolCall.function.name;
        await hooks.onChunk(`\n[${name}]...\n`);

        let result: unknown;
        try {
          const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          switch (name) {
            case 'create_and_join_slack_channel':
              result = await toolCreateAndJoinSlackChannel(
                input.channel_name as string,
                input.user_id as string,
              );
              break;
            case 'get_slack_channel_messages':
              result = await toolGetSlackChannelMessages(input.channel_id as string);
              break;
            case 'fetch_list_of_incidents_from_notion':
              result = await toolFetchListOfIncidentsFromNotion();
              break;
            case 'create_new_incident_in_notion':
              result = await toolCreateNewIncidentInNotion(input);
              break;
            case 'update_notion_incident_page':
              result = await toolUpdateNotionIncidentPage(input);
              break;
            default:
              result = { error: `Unknown tool: ${name}` };
          }
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          await hooks.onChunk(`  error: ${(result as Record<string, string>).error}\n`);
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    } else {
      break;
    }
  }
}
```

- [ ] **Step 2: Run tests — verify still 25 pass**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `25 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/agent/index.ts && git commit -m "add tools, system prompt, and agentic loop for incident-manager-agent"
```

---

## Task 6: Add webhook server and Astropods adapter to index.ts

**Files:**
- Modify: `incident-manager-agent/agent/index.ts`

- [ ] **Step 1: Append webhook server, adapter, and serve call**

Read the current file, then append:

```typescript
// ---------------------------------------------------------------------------
// Slack webhook HTTP server (port 3000)
// ---------------------------------------------------------------------------

function startWebhookServer(): void {
  try {
    Bun.serve({
      port: 3000,
      async fetch(req) {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }

        let payload: unknown;
        try {
          payload = await req.json();
        } catch {
          return new Response('Invalid JSON', { status: 400 });
        }

        // Respond immediately to Slack, process async
        runAgentLoop(payload, {
          onChunk: (text) => { process.stdout.write(text); },
          onError: (err) => { console.error('Agent error:', err.message); },
          onFinish: () => { console.log('\nAgent finished.'); },
          onStatusUpdate: () => {},
          onTranscript: () => {},
          onAudioChunk: () => {},
          onAudioEnd: () => {},
        }).catch((err) => console.error('Unhandled error:', err));

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    console.log('Incident manager webhook server listening on :3000');
  } catch (err) {
    console.error('Failed to start webhook server:', err);
  }
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ---------------------------------------------------------------------------
// Astropods adapter (web chat / Slack)
// ---------------------------------------------------------------------------

const adapter: AgentAdapter = {
  name: 'incident-manager-agent',

  getConfig() {
    return {
      systemPrompt:
        'Manages Slack incidents and Notion documentation using GPT-4.1. Send a Slack webhook payload or slash command JSON to triage and track incidents.',
      tools: [],
    };
  },

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(prompt.trim());
    } catch {
      await hooks.onChunk(
        'Please send a valid Slack webhook JSON payload (slash command or message event).',
      );
      hooks.onFinish();
      return;
    }

    await runAgentLoop(payload, hooks);
    hooks.onFinish();
  },
};

startWebhookServer();
serve(adapter);
```

- [ ] **Step 2: Run tests — verify 25 pass**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `25 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/agent/index.ts && git commit -m "add webhook server and Astropods adapter for incident-manager-agent"
```

---

## Task 7: Create astropods.yml and AGENT.md

**Files:**
- Create: `incident-manager-agent/astropods.yml`
- Create: `incident-manager-agent/AGENT.md`

- [ ] **Step 1: Create astropods.yml**

```yaml
# yaml-language-server: $schema=https://astropods.ai/schema/package.json
spec: package/v1
name: "incident-manager-agent"

agent:
  build:
    context: .
    dockerfile: Dockerfile

models:
  openai:
    provider: openai

inputs:
  SLACK_BOT_TOKEN:
    name: SLACK_BOT_TOKEN
    datatype: string
    secret: true
    description: "Slack Bot OAuth token for channel management and message reading"
    display-as: short-text
  NOTION_API_KEY:
    name: NOTION_API_KEY
    datatype: string
    secret: true
    description: "Notion integration secret key"
    display-as: short-text
  NOTION_DATABASE_ID:
    name: NOTION_DATABASE_ID
    datatype: string
    description: "ID of the Notion database holding all incidents"
    display-as: short-text

dev:
  interfaces:
    messaging:
      adapters: [web, slack]
```

- [ ] **Step 2: Create AGENT.md**

```markdown
---
description: "Manages Slack incident channels and keeps a Notion incident database updated with AI-generated summaries."
---

# Incident Manager Agent

Receives Slack slash commands and message events. Uses GPT-4.1 to create dedicated incident channels, track incident status and severity, and keep a Notion database updated with structured summaries for engineering and support teams.

## How it works

**Slash command** (`/incident-management <description>`):
1. Creates a Slack channel named after the incident
2. Invites the triggering user to the channel
3. Creates an incident record in Notion (status: Not started)

**Message event** (activity in the incident channel):
1. Fetches all channel messages for full context
2. Matches the event to an existing Notion incident (by timestamp)
3. If the messages contain useful info, updates the Notion page:
   - Detail summary, engineering update, support update
   - Status (Not started / In progress / Done)
   - Severity (Critical / High / Medium / Low)
4. If resolved, closes the incident (status: Done)

## Slack app setup

Required OAuth scopes:
- `channels:manage` — create incident channels
- `channels:history` — read channel messages
- `channels:read` — channel info
- `chat:write` — post messages
- `commands` — receive slash commands

Event subscriptions: `message.channels`

Slash command URL: `https://<your-agent-url>:3000/` (POST to root path)

## Notion database setup

Create a database with these properties:
| Property | Type |
|---|---|
| Name | Title |
| Incident Date | Date |
| Status | Select (Not started, In progress, Done) |
| Severity Level | Select (Critical, High, Medium, Low) |
| Slack Channel ID | Text |

## Required environment variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `SLACK_BOT_TOKEN` | Bot User OAuth token from your Slack App |
| `NOTION_API_KEY` | Notion integration secret key |
| `NOTION_DATABASE_ID` | ID of the Notion incidents database |
```

- [ ] **Step 3: Run tests one final time**

```bash
cd /c/astro_ai_agents/incident-manager-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `25 pass, 0 fail`.

- [ ] **Step 4: Commit**

```bash
cd /c/astro_ai_agents && git add incident-manager-agent/astropods.yml incident-manager-agent/AGENT.md && git commit -m "add astropods config and docs for incident-manager-agent"
```
