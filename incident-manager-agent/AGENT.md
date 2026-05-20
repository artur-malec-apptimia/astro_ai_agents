# Incident Manager Agent

Slack-triggered incident management agent. Manages active incidents and keeps a Notion incident log updated.

## Triggers

- **Slash command** (`/incident-management <name>`): Creates a dedicated Slack channel for the incident and a Notion page to track it.
- **Message event** (in an incident channel): Reads all messages, determines current incident state, and updates the Notion page with a detail summary, engineering update, and support update.

## Tools

| Tool | Description |
|---|---|
| `create_and_join_slack_channel` | Creates a Slack channel, joins as bot, invites the user |
| `get_slack_channel_messages` | Fetches all messages from a Slack channel |
| `fetch_list_of_incidents_from_notion` | Lists all incidents from the Notion database |
| `create_new_incident_in_notion` | Creates a new incident page in Notion |
| `update_notion_incident_page` | Updates status, severity, and summary blocks on an existing page |

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (secret) |
| `NOTION_API_KEY` | Notion integration secret (secret) |
| `NOTION_DATABASE_ID` | Notion database ID for the incident log |
| `OPENAI_API_KEY` | Auto-injected by Astropods |

## Slack App Requirements

Scopes: `channels:manage`, `channels:history`, `channels:read`, `chat:write`, `commands`

Event subscriptions: `message.channels`

Slash command URL: `https://<agent-url>:3000/`
