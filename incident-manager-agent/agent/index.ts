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
