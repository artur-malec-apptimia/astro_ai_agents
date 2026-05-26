# Customer Call Follow-Up Agent — Design Spec

**Date:** 2026-05-26
**Status:** Approved

---

## Overview

A sales rep triggers the agent with a Zoom meeting ID (via webhook POST or chat message). The agent fetches the call transcript, extracts action items and issues, creates Zendesk tickets for any issues found, writes a call summary page to Notion, and returns a formatted action item list delivered through the platform's Slack or web adapter.

Based on the Postman "Post-Meeting Customer Tasks Agent" flow. `slack_bot_token` and `slack_user_id` removed — Slack delivery is handled by the platform adapter.

---

## Architecture

```
[Webhook POST :3000 { meetingId }]  ──┐
                                      ├──► agent.generate() ──► [Tools] ──► formatted response
[Chat / Slack message "meetingId"] ──┘                                   └──► adapter delivers to user
```

- `Bun.serve()` on port 3000 accepts `POST { meetingId }`. Returns `{ ok: true }` immediately (fire-and-forget).
- Direct chat/Slack messages containing a meeting ID work identically.
- No direct Slack API calls — response flows through the platform adapter.
- Model: `openai/gpt-4.1`

---

## Tools

### `get_zoom_transcript`
- **Input:** `meeting_id: string`
- **Steps:**
  1. POST `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token={ZOOM_REFRESH_TOKEN}` with Basic auth (`ZOOM_CLIENT_ID:ZOOM_CLIENT_SECRET`) → access token
  2. GET `https://api.zoom.us/v2/meetings/{meeting_id}/recordings` with Bearer token → recording files list
  3. Find file with `file_type === "TRANSCRIPT"` → `download_url`
  4. GET transcript content (Authorization header with Bearer token)
  5. Return raw VTT transcript text
- **Errors:** throws if no recordings found, no transcript file, or any HTTP error

### `create_zendesk_ticket`
- **Input:** `subject: string`, `description: string`
- **Steps:**
  1. POST `https://{ZENDESK_URL}.zendesk.com/api/v2/tickets.json` with Basic auth (`{ZENDESK_AGENT_EMAIL}/token:{ZENDESK_API_KEY}`)
  2. Returns `{ ticket_id, ticket_url }`
- **Errors:** throws on non-2xx response

### `update_notion_page`
- **Input:** `title: string`, `content: string`
- **Steps:**
  1. POST `https://api.notion.com/v1/pages` with `NOTION_API_KEY`
  2. Parent: `{ page_id: NOTION_PARENT_PAGE_ID }`
  3. Title property + paragraph blocks from content
  4. Returns created page URL
- **Errors:** throws on non-2xx response

---

## Agent Instructions

```
You are an AI assistant for sales reps. When given a Zoom meeting ID:

1. Call get_zoom_transcript with the meeting ID.
2. Read the transcript to identify:
   - The account/company name
   - A list of action items (things that were promised or need to happen next)
   - Any support issues that require a Zendesk ticket
3. For each support issue, call create_zendesk_ticket. The sales rep will be the ticket owner.
4. Call update_notion_page with a title of "<AccountName> - Call Summary <date>" and the full summary.
5. Return a formatted response with:
   - A bold header: "📋 Post-Call Action Items — <AccountName>"
   - Numbered action items, each prepended with the account name
   - Zendesk ticket links (if any were created)
   - Notion page link

Prepend each action item with the account name. Keep the response concise and Slack-friendly.
```

---

## Environment Variables

| Variable | Secret | Description |
|---|---|---|
| `ZOOM_CLIENT_ID` | ✅ | Zoom marketplace app client ID |
| `ZOOM_CLIENT_SECRET` | ✅ | Zoom marketplace app client secret |
| `ZOOM_REFRESH_TOKEN` | ✅ | OAuth2 refresh token from Zoom authorization |
| `ZENDESK_URL` | | Zendesk subdomain (the `{url}` in `https://{url}.zendesk.com`) |
| `ZENDESK_AGENT_EMAIL` | | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | ✅ | Zendesk API token |
| `NOTION_API_KEY` | ✅ | Notion internal integration secret |
| `NOTION_PARENT_PAGE_ID` | | ID of the Notion page that holds all call summary pages |

---

## Data Flow

```
meetingId
  → get_zoom_transcript → VTT text
  → LLM analysis → action items + issues
  → create_zendesk_ticket (0..n) → ticket IDs + URLs
  → update_notion_page → page URL
  → formatted response → adapter → Slack / web
```

---

## Error Handling

- If Zoom returns no recordings: agent informs user the meeting has no recordings yet.
- If transcript file is missing: agent informs user and stops (no partial output).
- If Zendesk ticket creation fails: agent logs the error and continues; notes failure in response.
- If Notion update fails: agent logs the error and continues; notes failure in response.
- Webhook server always returns `{ ok: true }` immediately — errors surface in agent logs.

---

## Testing

- `utils.test.ts` covers all utility functions with mocked `fetch`:
  - `refreshZoomToken` — happy path, error on non-ok
  - `getZoomTranscript` — finds TRANSCRIPT file, throws when missing
  - `buildZendeskAuth` — correct base64 encoding
  - `createZendeskTicket` — creates ticket, returns id + url
  - `createNotionPage` — creates page, returns url
- No integration tests (external APIs mocked)

---

## File Structure

```
customer-call-follow-up-agent/
├── agent/
│   ├── index.ts          # Mastra agent, 3 tools, webhook server, serve()
│   ├── utils.ts          # Zoom, Zendesk, Notion API helpers + types
│   └── utils.test.ts     # Unit tests (bun:test, mocked fetch)
├── docs/superpowers/specs/
│   └── 2026-05-26-customer-call-follow-up-agent-design.md
├── astropods.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── AGENT.md
├── README.md
└── .gitignore
```
