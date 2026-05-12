import { serve, type AgentAdapter, type StreamHooks, type StreamOptions } from '@astropods/adapter-core';
import OpenAI from 'openai';
import axios from 'axios';

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Zendesk helpers
// ---------------------------------------------------------------------------

function zendeskBase(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}

function zendeskAuth(): string {
  return Buffer.from(`${process.env.ZENDESK_AGENT_EMAIL}/token:${process.env.ZENDESK_API_KEY}`).toString('base64');
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function getZendeskTicket(ticketId: string) {
  const { data } = await axios.get(`${zendeskBase()}/tickets/${ticketId}`, {
    headers: { Authorization: `Basic ${zendeskAuth()}` },
  });
  return data.ticket;
}

async function getSolvedTicketComments(ticketId: string) {
  const { data } = await axios.get(`${zendeskBase()}/tickets/${ticketId}/comments`, {
    headers: { Authorization: `Basic ${zendeskAuth()}` },
  });
  return data.comments;
}

async function updateZendeskTicket(ticketId: string, status: string, comment: string) {
  const { data } = await axios.put(
    `${zendeskBase()}/tickets/${ticketId}`,
    { ticket: { status, comment: { body: comment, public: true } } },
    { headers: { Authorization: `Basic ${zendeskAuth()}`, 'Content-Type': 'application/json' } },
  );
  return data.ticket;
}

async function lookupZendeskAgent(agentId: string) {
  const { data } = await axios.get(`${zendeskBase()}/users/${agentId}`, {
    headers: { Authorization: `Basic ${zendeskAuth()}` },
  });
  return data.user;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const { data } = await axios.post(
    'https://api.openai.com/v1/embeddings',
    { input: text, model: 'text-embedding-3-small' },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' } },
  );
  return data.data[0].embedding;
}

async function retrieveEmbeddings(query: string, topK = 3) {
  const vector = await generateEmbedding(query);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const { data } = await axios.post(
        `${process.env.PINECONE_HOST}/query`,
        { vector, topK, includeMetadata: true },
        { headers: { 'Api-Key': process.env.PINECONE_API_KEY!, 'Content-Type': 'application/json' } },
      );
      return data.matches;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 5000));
        continue;
      }
      throw err;
    }
  }
}

async function updatePinecone(question: string, answer: string) {
  const vector = await generateEmbedding(question);
  const id = `ticket-${Date.now()}`;
  await axios.post(
    `${process.env.PINECONE_HOST}/vectors/upsert`,
    { vectors: [{ id, values: vector, metadata: { question, answer } }] },
    { headers: { 'Api-Key': process.env.PINECONE_API_KEY!, 'Content-Type': 'application/json' } },
  );
  return { id, question, answer };
}

async function notifyHumanAgent(message: string) {
  const token = process.env.SLACK_POSTING_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return { ok: false, error: 'Slack not configured' };
  const { data } = await axios.post(
    'https://slack.com/api/chat.postMessage',
    { channel, text: message },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// OpenAI tool definitions
// ---------------------------------------------------------------------------

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_zendesk_ticket',
      description: 'Get detailed information about a Zendesk ticket by ID.',
      parameters: {
        type: 'object',
        properties: { ticket_id: { type: 'string', description: 'The Zendesk ticket ID' } },
        required: ['ticket_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retrieve_embeddings',
      description: 'Search Pinecone for similar known Q&A pairs using semantic similarity. Returns matches with similarity scores.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The question or problem description to search for' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_zendesk_ticket',
      description: 'Update a Zendesk ticket status and post a public reply to the customer. Status meanings: open=pending on support, pending=waiting on customer, solved=customer is happy.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', description: 'The Zendesk ticket ID' },
          status: { type: 'string', enum: ['open', 'pending', 'solved'] },
          comment: { type: 'string', description: 'Public reply to the customer' },
        },
        required: ['ticket_id', 'status', 'comment'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_human_agent',
      description: 'Send a Slack notification to the human support team to escalate a ticket.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Escalation message with ticket details and reason' } },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_solved_ticket_comments',
      description: 'Get all comments for a solved Zendesk ticket to extract Q&A knowledge.',
      parameters: {
        type: 'object',
        properties: { ticket_id: { type: 'string', description: 'The Zendesk ticket ID' } },
        required: ['ticket_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_pinecone',
      description: 'Add a new Q&A pair to the Pinecone knowledge base. Only call this for clean, concise Q&A pairs.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The customer question — concise, no superfluous text' },
          answer: { type: 'string', description: 'The resolution — concise, no superfluous text' },
        },
        required: ['question', 'answer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_zendesk_agent',
      description: 'Look up a Zendesk user/agent by ID to determine if they are a human agent (not a bot).',
      parameters: {
        type: 'object',
        properties: { agent_id: { type: 'string', description: 'The Zendesk user/agent ID' } },
        required: ['agent_id'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a customer support triage agent connected to Zendesk.

When you receive a webhook payload:

FOR ticket.created events:
1. Get the ticket details using get_zendesk_ticket
2. Search for similar known answers using retrieve_embeddings
3. If you find a highly confident match (score > 0.85), reply professionally and update the ticket to "pending" status
4. If the customer confirms satisfaction, update to "solved"
5. If no confident answer found, notify the human support team via Slack and update ticket to "open"
6. Never mark a ticket as solved unless the customer is clearly happy with the resolution

FOR ticket.status_changed to SOLVED events:
1. Get the solved ticket comments using get_solved_ticket_comments
2. Check who solved it using lookup_zendesk_agent — only proceed if it was a human agent (not a bot)
3. Search Pinecone to check if this Q&A already exists using retrieve_embeddings
4. If it's a human-solved ticket and the question isn't already in Pinecone (score < 0.9), add it with update_pinecone
5. Extract only the core question and answer — no ticket numbers, greetings, or superfluous text

Status meanings:
- open: pending on customer support
- pending: waiting on the customer
- solved: customer is happy with the resolution`;

async function runAgentLoop(webhookPayload: unknown, hooks: StreamHooks): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Zendesk webhook received:\n\n${JSON.stringify(webhookPayload, null, 2)}` },
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
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
          const input = JSON.parse(toolCall.function.arguments) as Record<string, string>;
          switch (name) {
            case 'get_zendesk_ticket':
              result = await getZendeskTicket(input.ticket_id);
              break;
            case 'retrieve_embeddings':
              result = await retrieveEmbeddings(input.query);
              break;
            case 'update_zendesk_ticket':
              result = await updateZendeskTicket(input.ticket_id, input.status, input.comment);
              break;
            case 'notify_human_agent':
              result = await notifyHumanAgent(input.message);
              break;
            case 'get_solved_ticket_comments':
              result = await getSolvedTicketComments(input.ticket_id);
              break;
            case 'update_pinecone':
              result = await updatePinecone(input.question, input.answer);
              break;
            case 'lookup_zendesk_agent':
              result = await lookupZendeskAgent(input.agent_id);
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
// Astropods adapter (web chat / testing)
// ---------------------------------------------------------------------------

const adapter: AgentAdapter = {
  name: 'ticket-triage-agent',

  getConfig() {
    return {
      systemPrompt:
        'Customer support triage agent. Send a Zendesk webhook payload as JSON to process it. Auto-resolves tickets using Pinecone knowledge base, escalates to humans when unsure, and learns from human-solved tickets.',
      tools: [],
    };
  },

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    let payload: unknown;
    const text = prompt.trim();

    try {
      // Try JSON first (webhook payload)
      payload = JSON.parse(text);
    } catch {
      // Plain text — extract ticket ID (number) or treat as search query
      const idMatch = text.match(/\b(\d+)\b/);
      if (idMatch) {
        payload = {
          type: 'zen:event-type:ticket.created',
          detail: { id: idMatch[1] },
        };
      } else {
        await hooks.onChunk(
          'Please send a Zendesk ticket ID (e.g. `12345`) or a full webhook JSON payload.',
        );
        hooks.onFinish();
        return;
      }
    }

    await runAgentLoop(payload, hooks);
    hooks.onFinish();
  },
};

startWebhookServer();
serve(adapter);
