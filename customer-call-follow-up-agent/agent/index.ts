import { serve } from '@astropods/adapter-core';
import { MastraAdapter } from '@astropods/adapter-mastra';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  refreshZoomToken,
  getZoomTranscript,
  createZendeskTicket,
  createNotionPage,
} from './utils';

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getZoomTranscriptTool = createTool({
  id: 'get_zoom_transcript',
  description:
    'Fetches the transcript for a completed Zoom meeting recording using the meeting ID.',
  inputSchema: z.object({
    meeting_id: z.string().describe('The Zoom meeting ID (numeric or UUID format)'),
  }),
  execute: async ({ meeting_id }: { meeting_id: string }) => {
    const accessToken = await refreshZoomToken(
      env('ZOOM_CLIENT_ID'),
      env('ZOOM_CLIENT_SECRET'),
      env('ZOOM_REFRESH_TOKEN'),
    );
    return getZoomTranscript(accessToken, meeting_id);
  },
});

const createZendeskTicketTool = createTool({
  id: 'create_zendesk_ticket',
  description:
    'Creates a Zendesk support ticket for a customer issue identified in the call transcript.',
  inputSchema: z.object({
    subject: z.string().describe('Short title for the ticket (max 150 chars)'),
    description: z
      .string()
      .describe('Full description of the issue, including context from the call'),
  }),
  execute: async ({ subject, description }: { subject: string; description: string }) => {
    const result = await createZendeskTicket(
      env('ZENDESK_URL'),
      env('ZENDESK_AGENT_EMAIL'),
      env('ZENDESK_API_KEY'),
      subject,
      description,
    );
    return JSON.stringify(result);
  },
});

const updateNotionPageTool = createTool({
  id: 'update_notion_page',
  description:
    'Creates a Notion page under the configured parent page with the call summary and action items.',
  inputSchema: z.object({
    title: z
      .string()
      .describe('Page title, e.g. "Acme Corp - Call Summary 2026-05-26"'),
    content: z
      .string()
      .describe('Full call summary and action items as plain text'),
  }),
  execute: async ({ title, content }: { title: string; content: string }) => {
    const result = await createNotionPage(
      env('NOTION_API_KEY'),
      env('NOTION_PARENT_PAGE_ID'),
      title,
      content,
    );
    return JSON.stringify(result);
  },
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are an AI assistant for sales reps. When given a Zoom meeting ID, follow these steps:

1. Call get_zoom_transcript with the meeting ID to retrieve the call transcript.
2. Read the transcript carefully to identify:
   - The account/company name of the customer
   - A list of action items (commitments made, next steps, follow-ups required)
   - Any support issues that require a Zendesk ticket
3. For each support issue, call create_zendesk_ticket. The sales rep is the ticket owner.
4. Call update_notion_page with title "<AccountName> - Call Summary <YYYY-MM-DD>" and the full summary including all action items.
5. Return a clean, Slack-friendly response with:
   - Bold header: "*📋 Post-Call Action Items — <AccountName>*"
   - Numbered action items, each prepended with the account name
   - Zendesk ticket IDs and URLs if any were created
   - Notion page link

If the transcript contains no action items, say so clearly. If Zendesk or Notion calls fail, note the failure but still return the action items.`;

const memory = new Memory({
  storage: new LibSQLStore({ id: 'memory', url: ':memory:' }),
});

const agent = new Agent({
  id: 'customer-call-follow-up-agent',
  name: 'Customer Call Follow-Up Agent',
  instructions: INSTRUCTIONS,
  model: 'openai/gpt-4.1',
  memory,
  tools: {
    get_zoom_transcript: getZoomTranscriptTool,
    create_zendesk_ticket: createZendeskTicketTool,
    update_notion_page: updateNotionPageTool,
  },
});

new Mastra({ agents: { 'customer-call-follow-up-agent': agent } });

// ---------------------------------------------------------------------------
// Webhook server (port 3000)
// ---------------------------------------------------------------------------

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

    const meetingId =
      typeof payload === 'object' &&
      payload !== null &&
      'meetingId' in payload
        ? String((payload as Record<string, unknown>).meetingId)
        : null;

    if (!meetingId) {
      return new Response(JSON.stringify({ error: 'meetingId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    agent
      .generate(`Process the Zoom call transcript for meeting ID: ${meetingId}`)
      .then((result) =>
        console.log('[webhook] processed meeting', meetingId, ':', result.text?.slice(0, 200)),
      )
      .catch((err) =>
        console.error('[webhook] agent error:', err instanceof Error ? err.message : String(err)),
      );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

console.log('Webhook server listening on :3000');

serve(new MastraAdapter(agent));
