---
description: "Fetches and summarises industry news from NewsAPI, GNews, The Guardian, and MediaStack using GPT-4o mini."
---

# Industry News Agent

Monitors industry news by fetching articles in parallel from four sources, deduplicating by title, and delivering an AI-summarised briefing with key themes, top stories, and a takeaway. Optionally posts the summary to a Slack channel.

## Usage

Send a topic in the chat:

```
AI news
startup funding
quantum computing
electric vehicles Europe
```

## Required configuration

| Key | Source |
|-----|--------|
| `NEWS_API_KEY` | newsapi.org |
| `GNEWS_API_KEY` | gnews.io |
| `GUARDIAN_API_KEY` | open-platform.theguardian.com |
| `MEDIASTACK_API_KEY` | mediastack.com |
| `OPENAI_API_KEY` | Auto-injected via `models.openai` |

## Optional configuration

| Key | Purpose |
|-----|---------|
| `SLACK_BOT_TOKEN` | Post summary to Slack |
| `SLACK_CHANNEL_ID` | Target Slack channel (e.g. `C012AB3CD`) |
