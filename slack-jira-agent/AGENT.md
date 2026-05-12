---
description: "Converts Slack problem descriptions or thread content into Jira tickets automatically."
---

# Slack to Jira Agent

Converts Slack problem descriptions or thread content into Jira tickets automatically.

## What it does

1. Receives a message containing a problem description or Slack thread content
2. Uses GPT-4o mini to generate a concise Jira ticket title and detailed description
3. Creates the ticket in Jira via REST API
4. Responds with a direct link to the created ticket

## Usage

Send a message describing the problem or paste a Slack thread. The agent will:
- Extract the key issue from the message
- Create a properly formatted Jira task
- Return the ticket URL (e.g. `https://mycompany.atlassian.net/browse/PROJ-123`)

## Required environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (injected automatically) |
| `JIRA_API_KEY` | Jira API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_USERNAME` | Jira account email address |
| `JIRA_SUBDOMAIN` | Jira subdomain (e.g. `mycompany` for `mycompany.atlassian.net`) |
| `JIRA_PROJECT_ID` | Jira project key (e.g. `PROJ`) |

## Optional environment variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot token for future Slack API integration |
| `SLACK_SUBDOMAIN` | Slack workspace subdomain |

## Model

Uses `gpt-4o-mini` for fast, cost-efficient ticket generation.
