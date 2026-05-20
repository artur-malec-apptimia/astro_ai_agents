# Incident Manager Agent — Design Spec

**Date:** 2026-05-20
**Source:** Postman incident-management-agent flow

---

## Overview

A Slack-triggered incident management agent. A `/incident-management` slash command creates a dedicated Slack channel. Subsequent Slack events in that channel trigger the agent to read messages, determine incident state, and keep a Notion incident log updated with structured summaries.

---

## Architecture

Same pattern as `route-urgent-tickets-agent`:

- **Webhook server** (Bun, port 3000) responds immediately to Slack (required — Slack needs <3s response), processes async
- **GPT-4.1 agentic loop** decides which tools to call and in what order
- **Astropods adapter** for web/Slack chat testing
- **`utils.ts`** holds all pure API helper functions, tested independently

---

## Agent Behavior

**Slash command trigger** (`command` field present in payload):
1. Parse the incident name from the slash command text
2. Create a Slack channel named after the incident
3. Invite the triggering user to the channel
4. Check Notion for an existing incident — create one if not found
5. Do nothing else (no summary yet — no messages to summarize)

**Message event trigger** (no `command` field):
1. Fetch all messages from the incident channel
2. Fetch the list of incidents from Notion to find the matching one
3. Determine if this is an existing incident or a new one (use timestamps)
4. If the messages contain useful info, update the Notion page:
   - Detail summary
   - Engineering team update
   - Support team update
   - Status and severity level
5. If the incident is resolved, close it (set status to Done) — no further updates unless warranted

---

## Tools (5)

### 1. `create_and_join_slack_channel`
- **Slack APIs:** `conversations.create` → `conversations.join` (bot joins) → `conversations.invite` (invite user)
- **Params:** `channel_name` (string), `user_id` (string)
- **Returns:** `{ channel_id, channel_name }`

### 2. `get_slack_channel_messages`
- **Slack API:** `conversations.history`
- **Params:** `channel_id` (string)
- **Returns:** array of messages `{ ts, user, text }`

### 3. `fetch_list_of_incidents_from_notion`
- **Notion API:** `POST /databases/{NOTION_DATABASE_ID}/query`
- **Params:** none (reads `NOTION_DATABASE_ID` from env)
- **Returns:** array of `{ page_id, name, status, severity_level, incident_date, slack_channel_id }`

### 4. `create_new_incident_in_notion`
- **Notion API:** `POST /pages`
- **Params:** `name`, `incident_date` (YYYY-MM-DD), `status`, `severity_level`, `detail_summary`, `engineering_update`, `support_update`, `slack_channel_id`
- **Properties stored:** Name (title), Incident Date (date), Status (select), Severity Level (select), Slack Channel ID (rich_text)
- **Page body blocks:** Detail Summary, Engineering Update, Support Update (heading2 + paragraph per section)
- **Returns:** `{ page_id }`

### 5. `update_notion_incident_page`
- **Notion APIs:** `PATCH /pages/{page_id}` (properties) + archive existing child blocks (`PATCH /blocks/{block_id}` with `archived: true`) + append new blocks (`PATCH /blocks/{page_id}/children`)
- **Params:** `page_id`, `status`, `severity_level`, `detail_summary`, `engineering_update`, `support_update`
- **Returns:** `{ page_id }`

---

## Notion Database Schema

| Property | Type | Values |
|---|---|---|
| Name | title | incident name |
| Incident Date | date | YYYY-MM-DD |
| Status | select | Not started, In progress, Done |
| Severity Level | select | Critical, High, Medium, Low |
| Slack Channel ID | rich_text | Slack channel ID string |

Page body stores: **Detail Summary**, **Engineering Update**, **Support Update** as heading2 + paragraph blocks.

---

## System Prompt (from Postman flow)

> You are responsible for managing an ongoing incident. A slash command from Slack will trigger the incident, use the command text to create a channel for the user. Do nothing else for this step scenario.
>
> You will also receive slack events that aren't a slash command. Check for the presence of the "command" field to decide.
>
> Don't rely on the text of the event, ensure you understand the full context by pulling all the messages in the incident channel.
>
> When you receive these events, check if the current incident matches an existing incident or if a new one needs to be created, take into account timestamps for this.
>
> When you receive events for the messages that aren't a slash command, decide whether the incident notes or summaries need to be updated. Make sure you actually have some useful info, don't just update it with filler info. Don't make a new channel for message events that aren't a slash command.
>
> acceptable incident_status (one of: Not started, In progress, Done), and severity_level (one of Critical, High, Medium, Low)
>
> You will provide a detail summary, an update for engineering teams, and an update for supports teams that will be as of the current timestamp.
>
> Summary timestamps only should be in the format: yyyy-mm-dd hh:mm am/pm very human readable.
>
> Once an incident is resolved feel free to close it and you don't need to make further updates unless they warrant reopening the incident.

---

## Environment Variables

| Variable | Type | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | secret | Slack Bot OAuth token |
| `NOTION_API_KEY` | secret | Notion integration secret |
| `NOTION_DATABASE_ID` | string | Notion database holding incidents |
| `OPENAI_API_KEY` | — | Auto-injected by Astropods |

---

## File Structure

```
incident-manager-agent/
├── package.json           # openai, @astropods/adapter-core, devDeps
├── tsconfig.json          # ES2022, bundler, strict
├── Dockerfile             # oven/bun:1, port 3000
├── .gitignore
├── astropods.yml          # openai model, 3 inputs, web+slack adapters
├── AGENT.md
└── agent/
    ├── utils.ts           # Slack + Notion helper functions
    ├── utils.test.ts      # Unit tests (bun:test, mocked fetch)
    └── index.ts           # TOOLS, system prompt, runAgentLoop, webhook, adapter
```

---

## utils.ts Exports

```typescript
// Slack
export function slackHeaders(token: string): Record<string, string>
export async function createSlackChannel(token: string, name: string): Promise<{ id: string; name: string }>
export async function joinSlackChannel(token: string, channelId: string): Promise<void>
export async function inviteToSlackChannel(token: string, channelId: string, userId: string): Promise<void>
export async function getSlackChannelMessages(token: string, channelId: string): Promise<{ ts: string; user: string; text: string }[]>

// Notion
export function notionHeaders(apiKey: string): Record<string, string>
export async function fetchIncidentsFromNotion(apiKey: string, databaseId: string): Promise<IncidentRecord[]>
export async function createIncidentInNotion(apiKey: string, databaseId: string, data: CreateIncidentData): Promise<{ page_id: string }>
export async function updateIncidentInNotion(apiKey: string, pageId: string, data: UpdateIncidentData): Promise<{ page_id: string }>

// Shared types
export interface IncidentRecord { page_id: string; name: string; status: string; severity_level: string; incident_date: string; slack_channel_id: string }
export interface CreateIncidentData { name: string; incident_date: string; status: string; severity_level: string; detail_summary: string; engineering_update: string; support_update: string; slack_channel_id: string }
export interface UpdateIncidentData { status: string; severity_level: string; detail_summary: string; engineering_update: string; support_update: string }
```

---

## Testing Strategy

Unit tests in `utils.test.ts` using `bun:test` with `global.fetch` mocked via `spyOn`:

- `slackHeaders` — correct Authorization header format
- `createSlackChannel` — POST to correct Slack URL, returns id + name
- `joinSlackChannel` — POST to conversations.join
- `inviteToSlackChannel` — POST to conversations.invite
- `getSlackChannelMessages` — GET conversations.history, returns message array
- `notionHeaders` — correct Notion headers (Authorization, Notion-Version, Content-Type)
- `fetchIncidentsFromNotion` — POST to database query, maps response to IncidentRecord[]
- `createIncidentInNotion` — POST to pages, correct property structure
- `updateIncidentInNotion` — PATCH to pages, correct property structure

Target: ~25 tests.

---

## Slack App Requirements

Scopes needed:
- `channels:manage` — create channels
- `channels:history` — read messages
- `channels:read` — channel info
- `chat:write` — post messages
- `commands` — receive slash commands

Event subscriptions: `message.channels`

Slash command URL: `https://<agent-url>:3000/`
