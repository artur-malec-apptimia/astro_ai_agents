import OpenAI from 'openai';
import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import {
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
  fetchIncidentsFromNotion,
  createIncidentInNotion,
  updateIncidentInNotion,
} from './utils.js';
import type { CreateIncidentData, UpdateIncidentData } from './utils.js';

// ---------------------------------------------------------------------------
// Env guards
// ---------------------------------------------------------------------------

function slackToken(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('SLACK_BOT_TOKEN is not set');
  return t;
}

function notionApiKey(): string {
  const k = process.env.NOTION_API_KEY;
  if (!k) throw new Error('NOTION_API_KEY is not set');
  return k;
}

function notionDatabaseId(): string {
  const d = process.env.NOTION_DATABASE_ID;
  if (!d) throw new Error('NOTION_DATABASE_ID is not set');
  return d;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function create_and_join_slack_channel(
  channel_name: string,
  user_id: string,
): Promise<{ channel_id: string; channel_name: string }> {
  const token = slackToken();
  const channel = await createSlackChannel(token, channel_name);
  await joinSlackChannel(token, channel.id);
  await inviteToSlackChannel(token, channel.id, user_id);
  return { channel_id: channel.id, channel_name: channel.name };
}

async function get_slack_channel_messages(
  channel_id: string,
): Promise<{ ts: string; user: string; text: string }[]> {
  return getSlackChannelMessages(slackToken(), channel_id);
}

async function fetch_list_of_incidents_from_notion(): Promise<
  { page_id: string; name: string; status: string; severity_level: string; incident_date: string; slack_channel_id: string }[]
> {
  return fetchIncidentsFromNotion(notionApiKey(), notionDatabaseId());
}

async function create_new_incident_in_notion(data: CreateIncidentData): Promise<{ page_id: string }> {
  return createIncidentInNotion(notionApiKey(), notionDatabaseId(), data);
}

async function update_notion_incident_page(
  page_id: string,
  data: UpdateIncidentData,
): Promise<{ page_id: string }> {
  return updateIncidentInNotion(notionApiKey(), page_id, data);
}

// ---------------------------------------------------------------------------
// OpenAI client + tool definitions
// ---------------------------------------------------------------------------

const openai = new OpenAI();

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_and_join_slack_channel',
      description: 'Creates a new Slack channel, joins it as the bot, and invites the specified user.',
      parameters: {
        type: 'object',
        properties: {
          channel_name: { type: 'string', description: 'Name for the new Slack channel' },
          user_id: { type: 'string', description: 'Slack user ID to invite to the channel' },
        },
        required: ['channel_name', 'user_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_slack_channel_messages',
      description: 'Fetches all messages from a Slack channel.',
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
      description: 'Fetches the list of all incidents from the Notion database.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_new_incident_in_notion',
      description: 'Creates a new incident page in Notion with properties and summary blocks.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Incident name' },
          incident_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          status: { type: 'string', description: 'One of: Not started, In progress, Done' },
          severity_level: { type: 'string', description: 'One of: Critical, High, Medium, Low' },
          detail_summary: { type: 'string', description: 'Detailed summary of the incident' },
          engineering_update: { type: 'string', description: 'Update for the engineering team' },
          support_update: { type: 'string', description: 'Update for the support team' },
          slack_channel_id: { type: 'string', description: 'Slack channel ID for this incident' },
        },
        required: ['name', 'incident_date', 'status', 'severity_level', 'detail_summary', 'engineering_update', 'support_update', 'slack_channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_notion_incident_page',
      description: 'Updates an existing Notion incident page with new status, severity, and summary blocks.',
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: 'Notion page ID of the incident' },
          status: { type: 'string', description: 'One of: Not started, In progress, Done' },
          severity_level: { type: 'string', description: 'One of: Critical, High, Medium, Low' },
          detail_summary: { type: 'string', description: 'Detailed summary of the incident' },
          engineering_update: { type: 'string', description: 'Update for the engineering team' },
          support_update: { type: 'string', description: 'Update for the support team' },
        },
        required: ['page_id', 'status', 'severity_level', 'detail_summary', 'engineering_update', 'support_update'],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are responsible for managing an ongoing incident. A slash command from Slack will trigger the incident, use the command text to create a channel for the user. Do nothing else for this step scenario.

You will also receive slack events that aren't a slash command. Check for the presence of the "command" field to decide.

Don't rely on the text of the event, ensure you understand the full context by pulling all the messages in the incident channel.

When you receive these events, check if the current incident matches an existing incident or if a new one needs to be created, take into account timestamps for this.

When you receive events for the messages that aren't a slash command, decide whether the incident notes or summaries need to be updated. Make sure you actually have some useful info, don't just update it with filler info. Don't make a new channel for message events that aren't a slash command.

acceptable incident_status (one of: Not started, In progress, Done), and severity_level (one of Critical, High, Medium, Low)

You will provide a detail summary, an update for engineering teams, and an update for supports teams that will be as of the current timestamp.

Summary timestamps only should be in the format: yyyy-mm-dd hh:mm am/pm very human readable.

Once an incident is resolved feel free to close it and you don't need to make further updates unless they warrant reopening the incident.`;

const MAX_ITERATIONS = 20;

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'create_and_join_slack_channel':
      return JSON.stringify(
        await create_and_join_slack_channel(args.channel_name as string, args.user_id as string),
      );
    case 'get_slack_channel_messages':
      return JSON.stringify(await get_slack_channel_messages(args.channel_id as string));
    case 'fetch_list_of_incidents_from_notion':
      return JSON.stringify(await fetch_list_of_incidents_from_notion());
    case 'create_new_incident_in_notion':
      return JSON.stringify(await create_new_incident_in_notion(args as unknown as CreateIncidentData));
    case 'update_notion_incident_page':
      return JSON.stringify(
        await update_notion_incident_page(args.page_id as string, args as unknown as UpdateIncidentData),
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runAgentLoop(prompt: string, hooks: StreamHooks): Promise<void> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      max_tokens: 4096,
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
        await hooks.onChunk(`\n[Using: ${toolCall.function.name}...]\n`);
        try {
          const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          const result = await executeTool(toolCall.function.name, input);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    } else {
      break;
    }
  }
}
