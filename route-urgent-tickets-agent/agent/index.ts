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
  if (!process.env.PAGERDUTY_API_KEY) throw new Error('PAGERDUTY_API_KEY is not set');
  if (!process.env.PAGERDUTY_FROM_EMAIL) throw new Error('PAGERDUTY_FROM_EMAIL is not set');
  return {
    Authorization: `Token token=${process.env.PAGERDUTY_API_KEY}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    From: process.env.PAGERDUTY_FROM_EMAIL,
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
