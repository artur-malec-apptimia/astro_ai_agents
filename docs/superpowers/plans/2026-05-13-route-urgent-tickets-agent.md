# Route Urgent Tickets Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Astropods agent that receives Zendesk ticket webhooks, applies relevant tags via AI, and routes urgent tickets to PagerDuty while leaving standard tickets after tagging.

**Architecture:** Agentic loop (same pattern as `ticket-triage-agent`) — GPT-4.1 with 4 function-calling tools decides which tools to call and in what order. Webhook server on port 3000 responds immediately to Zendesk and processes async.

**Tech Stack:** Bun, TypeScript, OpenAI SDK (`gpt-4.1`), axios, `@astropods/adapter-core`, bun:test

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `route-urgent-tickets-agent/package.json` | Create | Dependencies, scripts |
| `route-urgent-tickets-agent/tsconfig.json` | Create | TypeScript config |
| `route-urgent-tickets-agent/Dockerfile` | Create | Container build |
| `route-urgent-tickets-agent/.gitignore` | Create | Ignore node_modules, .env |
| `route-urgent-tickets-agent/agent/utils.ts` | Create | Pure functions: `buildZendeskBase`, `buildZendeskAuth`, `parseWebhookPayload` |
| `route-urgent-tickets-agent/agent/utils.test.ts` | Create | Unit tests for utils.ts |
| `route-urgent-tickets-agent/agent/index.ts` | Create | Tools, agentic loop, webhook server, Astropods adapter |
| `route-urgent-tickets-agent/astropods.yml` | Create | Astropods config: inputs, model, adapters |
| `route-urgent-tickets-agent/AGENT.md` | Create | Usage docs |

---

## Task 1: Scaffold boilerplate files

**Files:**
- Create: `route-urgent-tickets-agent/package.json`
- Create: `route-urgent-tickets-agent/tsconfig.json`
- Create: `route-urgent-tickets-agent/Dockerfile`
- Create: `route-urgent-tickets-agent/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "route-urgent-tickets-agent",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "bun run agent/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "openai": "^4.0.0",
    "@astropods/adapter-core": "latest",
    "axios": "^1.7.0"
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

- [ ] **Step 5: Commit**

```bash
git add route-urgent-tickets-agent/package.json route-urgent-tickets-agent/tsconfig.json route-urgent-tickets-agent/Dockerfile route-urgent-tickets-agent/.gitignore
git commit -m "scaffold route-urgent-tickets-agent boilerplate"
```

---

## Task 2: Create utils.ts and tests (TDD)

**Files:**
- Create: `route-urgent-tickets-agent/agent/utils.test.ts`
- Create: `route-urgent-tickets-agent/agent/utils.ts`

- [ ] **Step 1: Write utils.test.ts**

```typescript
import { describe, expect, test } from 'bun:test';
import { buildZendeskBase, buildZendeskAuth, parseWebhookPayload } from './utils';

describe('buildZendeskBase', () => {
  test('builds correct Zendesk API base URL', () => {
    expect(buildZendeskBase('mycompany')).toBe('https://mycompany.zendesk.com/api/v2');
  });

  test('uses the subdomain as-is', () => {
    expect(buildZendeskBase('acme-corp')).toBe('https://acme-corp.zendesk.com/api/v2');
  });
});

describe('buildZendeskAuth', () => {
  test('returns a base64-encoded string', () => {
    const result = buildZendeskAuth('agent@example.com', 'myapikey');
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  test('encodes email/token:apiKey format', () => {
    const result = buildZendeskAuth('agent@example.com', 'myapikey');
    const decoded = Buffer.from(result, 'base64').toString('utf-8');
    expect(decoded).toBe('agent@example.com/token:myapikey');
  });

  test('different credentials produce different tokens', () => {
    const a = buildZendeskAuth('user1@example.com', 'key1');
    const b = buildZendeskAuth('user2@example.com', 'key2');
    expect(a).not.toBe(b);
  });
});

describe('parseWebhookPayload', () => {
  test('parses a full webhook JSON payload', () => {
    const input = JSON.stringify({
      type: 'zen:event-type:ticket.created',
      detail: { id: '12345' },
    });
    const result = parseWebhookPayload(input) as { type: string; detail: { id: string } };
    expect(result.type).toBe('zen:event-type:ticket.created');
    expect(result.detail.id).toBe('12345');
  });

  test('wraps a bare ticket ID in a ticket.created payload', () => {
    const result = parseWebhookPayload('12345') as { type: string; detail: { id: string } };
    expect(result.type).toBe('zen:event-type:ticket.created');
    expect(result.detail.id).toBe('12345');
  });

  test('extracts ticket ID from natural language', () => {
    const result = parseWebhookPayload('check ticket 99876') as { detail: { id: string } };
    expect(result.detail.id).toBe('99876');
  });

  test('extracts the first number when multiple are present', () => {
    const result = parseWebhookPayload('ticket 111 or 222') as { detail: { id: string } };
    expect(result.detail.id).toBe('111');
  });

  test('returns null for plain text with no numbers', () => {
    expect(parseWebhookPayload('the login button is broken')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseWebhookPayload('')).toBeNull();
  });

  test('returns parsed JSON for any valid JSON object', () => {
    const input = JSON.stringify({ foo: 'bar' });
    const result = parseWebhookPayload(input) as { foo: string };
    expect(result.foo).toBe('bar');
  });

  test('passes JSON arrays through as payloads', () => {
    const result = parseWebhookPayload('[1,2,3]');
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd route-urgent-tickets-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: errors about missing `./utils` module.

- [ ] **Step 3: Create utils.ts**

```typescript
// ---------------------------------------------------------------------------
// Zendesk URL + auth builders
// ---------------------------------------------------------------------------

export function buildZendeskBase(subdomain: string): string {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

export function buildZendeskAuth(email: string, apiKey: string): string {
  return Buffer.from(`${email}/token:${apiKey}`).toString('base64');
}

// ---------------------------------------------------------------------------
// Prompt parser
// ---------------------------------------------------------------------------

// Parses a chat prompt into a webhook payload.
// Accepts: raw JSON object, a bare ticket ID number, or any text containing a number.
// Returns null when no ticket ID can be extracted and the input is not a JSON object.
export function parseWebhookPayload(text: string): object | null {
  try {
    const parsed = JSON.parse(text);
    // Only treat as a webhook payload if it's an object — bare numbers like
    // '12345' are valid JSON but should be handled as ticket IDs instead.
    if (parsed !== null && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // not JSON — fall through to ID extraction
  }

  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    return {
      type: 'zen:event-type:ticket.created',
      detail: { id: idMatch[1] },
    };
  }
  return null;
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
/c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `13 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add route-urgent-tickets-agent/agent/utils.ts route-urgent-tickets-agent/agent/utils.test.ts
git commit -m "add utils and tests for route-urgent-tickets-agent"
```

---

## Task 3: Create index.ts — tool implementations

**Files:**
- Create: `route-urgent-tickets-agent/agent/index.ts`

- [ ] **Step 1: Create index.ts with imports, Zendesk helpers, and PagerDuty helpers**

```typescript
import { serve, type AgentAdapter, type StreamHooks, type StreamOptions } from '@astropods/adapter-core';
import OpenAI from 'openai';
import axios from 'axios';
import { buildZendeskBase, buildZendeskAuth, parseWebhookPayload } from './utils';

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Zendesk helpers
// ---------------------------------------------------------------------------

function zendeskBase(): string {
  if (!process.env.ZENDESK_SUBDOMAIN) throw new Error('ZENDESK_SUBDOMAIN is not set');
  return buildZendeskBase(process.env.ZENDESK_SUBDOMAIN);
}

function zendeskAuth(): string {
  if (!process.env.ZENDESK_USERNAME) throw new Error('ZENDESK_USERNAME is not set');
  if (!process.env.ZENDESK_API_KEY) throw new Error('ZENDESK_API_KEY is not set');
  return buildZendeskAuth(process.env.ZENDESK_USERNAME, process.env.ZENDESK_API_KEY);
}

async function listZendeskTags(): Promise<{ name: string; count: number }[]> {
  const { data } = await axios.get(`${zendeskBase()}/tags`, {
    headers: { Authorization: `Basic ${zendeskAuth()}` },
  });
  return data.tags;
}

async function updateTicketTags(ticketId: string, tags: string[]): Promise<unknown> {
  const { data } = await axios.put(
    `${zendeskBase()}/tickets/${ticketId}/tags`,
    { tags },
    { headers: { Authorization: `Basic ${zendeskAuth()}`, 'Content-Type': 'application/json' } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// PagerDuty helpers
// ---------------------------------------------------------------------------

function pagerdutyHeaders(): Record<string, string> {
  return {
    Authorization: `Token token=${process.env.PAGERDUTY_API_KEY ?? ''}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    From: process.env.PAGERDUTY_FROM_EMAIL ?? '',
    'Content-Type': 'application/json',
  };
}

async function listPagerdutyServices(): Promise<{ id: string; name: string }[]> {
  const { data } = await axios.get('https://api.pagerduty.com/services', {
    headers: pagerdutyHeaders(),
  });
  return data.services;
}

async function createPagerdutyIncident(
  serviceId: string,
  title: string,
  description: string,
): Promise<unknown> {
  const { data } = await axios.post(
    'https://api.pagerduty.com/incidents',
    {
      incident: {
        type: 'incident',
        title,
        service: { id: serviceId, type: 'service_reference' },
        body: { type: 'incident_body', details: description },
      },
    },
    { headers: pagerdutyHeaders() },
  );
  return data.incident;
}
```

- [ ] **Step 2: Verify TypeScript compiles (no errors)**

```bash
cd route-urgent-tickets-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun run --no-run agent/index.ts 2>&1 | head -20
```

Expected: no TypeScript errors (may show runtime errors about missing env vars — that's fine).

- [ ] **Step 3: Commit**

```bash
git add route-urgent-tickets-agent/agent/index.ts
git commit -m "add tool implementations for route-urgent-tickets-agent"
```

---

## Task 4: Add TOOLS array, system prompt, and agentic loop to index.ts

**Files:**
- Modify: `route-urgent-tickets-agent/agent/index.ts`

- [ ] **Step 1: Append TOOLS array and system prompt after the PagerDuty helpers**

Add this after the `createPagerdutyIncident` function:

```typescript
// ---------------------------------------------------------------------------
// OpenAI tool definitions
// ---------------------------------------------------------------------------

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_zendesk_tags',
      description: 'Fetch all existing Zendesk tags so you can pick from real ones.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_ticket_tags',
      description: 'Apply selected tags to a Zendesk ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', description: 'The Zendesk ticket ID' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags to apply to the ticket',
          },
        },
        required: ['ticket_id', 'tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pagerduty_services',
      description: 'Fetch available PagerDuty services to find the right team to route to.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_pagerduty_incident',
      description: 'Create a PagerDuty incident for an urgent ticket.',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: 'The PagerDuty service ID to route to',
          },
          title: { type: 'string', description: 'Concise incident title' },
          description: {
            type: 'string',
            description: 'Incident description — include the Zendesk ticket URL',
          },
        },
        required: ['service_id', 'title', 'description'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a support ticket routing agent for Zendesk.

When you receive a ticket ID and description:

1. Fetch all available Zendesk tags using list_zendesk_tags
2. Analyse the description and select the most relevant tags
3. Update the ticket with those tags using update_ticket_tags
4. Assess urgency — if the ticket is high-priority or urgent (e.g. outage, service down, security vulnerability, data loss, P1/P2):
   a. Fetch PagerDuty services using list_pagerduty_services
   b. Select the most appropriate service based on the tags and description (e.g. IAM team, Platform team)
   c. Create a PagerDuty incident using create_pagerduty_incident — use a concise title and set the description to the Zendesk ticket URL
5. If the ticket is standard priority, stop after updating tags.

Respond with a brief summary: the tags applied, urgency level, and whether a PagerDuty incident was created.`;
```

- [ ] **Step 2: Append the agentic loop after the system prompt**

```typescript
// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

async function runAgentLoop(payload: unknown, hooks: StreamHooks): Promise<void> {
  const p = payload as { detail?: { id?: string; description?: string } };
  const ticketId = p?.detail?.id ?? 'unknown';
  const description = p?.detail?.description ?? '';
  const ticketUrl = `${process.env.ZENDESK_TICKET_URL ?? ''}/${ticketId}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Ticket ID: ${ticketId}\nDescription: ${description}\nZendesk ticket URL: ${ticketUrl}`,
    },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });

    const message = response.choices[0].message;

    if (message.content) {
      hooks.onChunk(message.content);
    }

    if (response.choices[0].finish_reason === 'stop') break;

    if (response.choices[0].finish_reason === 'tool_calls') {
      messages.push(message);

      for (const toolCall of message.tool_calls ?? []) {
        const name = toolCall.function.name;
        hooks.onChunk(`\n[${name}]...\n`);

        let result: unknown;
        try {
          const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          switch (name) {
            case 'list_zendesk_tags':
              result = await listZendeskTags();
              break;
            case 'update_ticket_tags':
              result = await updateTicketTags(
                input.ticket_id as string,
                input.tags as string[],
              );
              break;
            case 'list_pagerduty_services':
              result = await listPagerdutyServices();
              break;
            case 'create_pagerduty_incident':
              result = await createPagerdutyIncident(
                input.service_id as string,
                input.title as string,
                input.description as string,
              );
              break;
            default:
              result = { error: `Unknown tool: ${name}` };
          }
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          hooks.onChunk(`  error: ${(result as Record<string, string>).error}\n`);
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

- [ ] **Step 3: Commit**

```bash
git add route-urgent-tickets-agent/agent/index.ts
git commit -m "add tools, system prompt, and agentic loop"
```

---

## Task 5: Add webhook server and Astropods adapter to index.ts

**Files:**
- Modify: `route-urgent-tickets-agent/agent/index.ts`

- [ ] **Step 1: Append webhook server, adapter, and serve call at the bottom of index.ts**

```typescript
// ---------------------------------------------------------------------------
// Zendesk webhook HTTP server (port 3000)
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

        // Respond immediately to Zendesk, process async
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

    console.log('Zendesk webhook server listening on :3000');
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
  name: 'route-urgent-tickets-agent',

  getConfig() {
    return {
      systemPrompt:
        'Routes urgent Zendesk tickets to PagerDuty and applies relevant tags using GPT-4.1. Send a ticket ID or webhook JSON payload.',
      tools: [],
    };
  },

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    const payload = parseWebhookPayload(prompt.trim());

    if (payload === null) {
      await hooks.onChunk(
        'Please send a Zendesk ticket ID (e.g. `12345`) or a full webhook JSON payload.',
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

- [ ] **Step 2: Run tests to make sure nothing broke**

```bash
cd route-urgent-tickets-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `13 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
git add route-urgent-tickets-agent/agent/index.ts
git commit -m "add webhook server and Astropods adapter"
```

---

## Task 6: Create astropods.yml and AGENT.md

**Files:**
- Create: `route-urgent-tickets-agent/astropods.yml`
- Create: `route-urgent-tickets-agent/AGENT.md`

- [ ] **Step 1: Create astropods.yml**

```yaml
# yaml-language-server: $schema=https://astropods.ai/schema/package.json
spec: package/v1
name: "route-urgent-tickets-agent"

agent:
  build:
    context: .
    dockerfile: Dockerfile

models:
  openai:
    provider: openai

inputs:
  ZENDESK_SUBDOMAIN:
    name: ZENDESK_SUBDOMAIN
    datatype: string
    description: "The {subdomain} in https://{subdomain}.zendesk.com"
    display-as: short-text
  ZENDESK_USERNAME:
    name: ZENDESK_USERNAME
    datatype: string
    secret: true
    description: "Zendesk agent email address for API authentication"
    display-as: short-text
  ZENDESK_API_KEY:
    name: ZENDESK_API_KEY
    datatype: string
    secret: true
    description: "Zendesk API token"
    display-as: short-text
  ZENDESK_TICKET_URL:
    name: ZENDESK_TICKET_URL
    datatype: string
    description: "Base ticket URL e.g. https://mycompany.zendesk.com/agent/tickets"
    display-as: short-text
  PAGERDUTY_API_KEY:
    name: PAGERDUTY_API_KEY
    datatype: string
    secret: true
    description: "PagerDuty REST API key"
    display-as: short-text
  PAGERDUTY_FROM_EMAIL:
    name: PAGERDUTY_FROM_EMAIL
    datatype: string
    description: "Email address for PagerDuty From header (required by PagerDuty API)"
    display-as: short-text

dev:
  interfaces:
    messaging:
      adapters: [web, slack]
```

- [ ] **Step 2: Create AGENT.md**

```markdown
---
description: "Receives Zendesk ticket webhooks, applies relevant tags using AI, and routes urgent tickets to the correct PagerDuty team."
---

# Route Urgent Tickets Agent

Automatically triages incoming Zendesk tickets. Uses GPT-4.1 to analyse ticket content, apply relevant tags, and route urgent issues to the correct PagerDuty service (e.g. IAM, Platform). Standard tickets are tagged only — no escalation.

## How it works

**New ticket webhook:**
1. Reads ticket ID and description from the webhook payload
2. Fetches all existing Zendesk tags and selects the most relevant ones
3. Updates the ticket with the selected tags
4. Assesses urgency from the description and tags:
   - **Urgent** (outage, security, data loss, P1/P2) → fetches PagerDuty services → creates incident routed to the correct team
   - **Standard** → stops after tagging

## Webhook setup

Configure a Zendesk webhook to `POST` to your agent's URL on port `3000`:
- **Trigger:** Ticket created → send to `https://<your-agent-url>:3000`

## Usage via web chat or Slack

| Message | Effect |
|---------|--------|
| `12345` | Triage ticket #12345 |
| `check ticket 12345` | Any text containing a ticket ID |
| `{"detail":{"id":"12345","description":"..."}}` | Full webhook payload |

## Required environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Auto-injected by Astropods |
| `ZENDESK_SUBDOMAIN` | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_USERNAME` | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | Zendesk API token |
| `ZENDESK_TICKET_URL` | Base ticket URL e.g. `https://mycompany.zendesk.com/agent/tickets` |
| `PAGERDUTY_API_KEY` | PagerDuty REST API key |
| `PAGERDUTY_FROM_EMAIL` | Email for PagerDuty `From` header (required by PagerDuty API) |
```

- [ ] **Step 3: Run tests one final time**

```bash
cd route-urgent-tickets-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `13 pass, 0 fail`

- [ ] **Step 4: Commit**

```bash
git add route-urgent-tickets-agent/astropods.yml route-urgent-tickets-agent/AGENT.md
git commit -m "add astropods config and docs for route-urgent-tickets-agent"
```
