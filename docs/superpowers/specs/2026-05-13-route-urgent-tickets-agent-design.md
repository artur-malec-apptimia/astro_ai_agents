# Route Urgent Tickets Agent — Design Spec

**Date:** 2026-05-13
**Status:** Approved

---

## Overview

A new Astropods agent that receives Zendesk ticket webhooks, classifies urgency using AI, applies relevant tags, and routes tickets to the appropriate team:

- **Urgent/high-priority** → PagerDuty incident, routed to the correct service (e.g. IAM, Platform)
- **Standard** → tags updated, no external escalation

Based on the Postman flow "Support Ticket Triage & Routing Agent" and follows the same patterns as `ticket-triage-agent`.

---

## Architecture & Flow

```
Zendesk webhook (port 3000) ─┐
                              ├→ runAgentLoop() → OpenAI tool calls → Zendesk / PagerDuty
Web chat / Slack message ─────┘
```

1. Zendesk fires a webhook on ticket creation → hits port 3000
2. Agent reads `detail.id` + `detail.description` from the payload
3. Agentic loop starts — up to 10 iterations, GPT-4.1 with function-calling tools
4. AI fetches existing Zendesk tags → picks relevant ones → updates the ticket
5. AI assesses urgency from the description + assigned tags
6. **If urgent:** fetches PagerDuty services → picks the right team → creates incident with the Zendesk ticket URL
7. **If standard:** tags updated, no PagerDuty action
8. Webhook server responds immediately with `200 OK`, agent loop runs async

Web chat / Slack: send a ticket ID or JSON payload, agent processes it and streams the result back.

---

## Tools (4)

| Tool | API Call | Purpose |
|---|---|---|
| `list_zendesk_tags` | `GET /tags` | Fetch all existing tags so AI picks from real ones |
| `update_ticket_tags` | `PUT /tickets/{id}/tags` | Apply selected tags to the ticket |
| `list_pagerduty_services` | `GET /services` | Fetch available services so AI routes to the right team |
| `create_pagerduty_incident` | `POST /incidents` | Create incident with ticket URL + urgency details |

---

## Environment Variables

| Variable | Type | Description |
|---|---|---|
| `ZENDESK_SUBDOMAIN` | string | The `{subdomain}` in `https://{subdomain}.zendesk.com` |
| `ZENDESK_USERNAME` | secret | Zendesk agent email for API auth |
| `ZENDESK_API_KEY` | secret | Zendesk API token |
| `ZENDESK_TICKET_URL` | string | Base ticket URL e.g. `https://mycompany.zendesk.com/agent/tickets` — used to build PagerDuty incident description |
| `PAGERDUTY_API_KEY` | secret | PagerDuty REST API key |
| `PAGERDUTY_FROM_EMAIL` | string | Email in PagerDuty `From` header (required by PagerDuty API) |

`OPENAI_API_KEY` is auto-injected by Astropods via the `models.openai` provider.

---

## File Structure

```
route-urgent-tickets-agent/
├── agent/
│   ├── index.ts          # agentic loop, tools, webhook server, Astropods adapter
│   ├── utils.ts          # pure functions: buildZendeskBase, buildZendeskAuth, parseWebhookPayload
│   └── utils.test.ts     # unit tests (bun:test)
├── AGENT.md              # description, usage, env vars
├── astropods.yml         # inputs, openai model provider, web+slack adapters
├── Dockerfile
├── package.json          # deps: openai, axios, @astropods/adapter-core
├── tsconfig.json
└── .gitignore
```

---

## Key Implementation Details

**Agentic loop** — identical pattern to `ticket-triage-agent`: OpenAI function-calling with up to 10 iterations, AI decides tool call order.

**Webhook server** — `Bun.serve` on port 3000, responds `200 OK` immediately, runs agent loop async (same as `ticket-triage-agent`).

**`utils.ts`** — reuses the three pure functions from `ticket-triage-agent`: `buildZendeskBase`, `buildZendeskAuth`, `parseWebhookPayload`. No changes to their logic.

**System prompt** — instructs the AI to:
1. Read description and assess urgency
2. Fetch and apply relevant Zendesk tags
3. If urgent: fetch PagerDuty services, pick the right one, create incident with `ZENDESK_TICKET_URL/{id}`
4. If standard: stop after tagging

**PagerDuty incident description** built as: `${ZENDESK_TICKET_URL}/${ticket_id}`

---

## Testing

- `utils.test.ts` with `bun:test` — same tests as `ticket-triage-agent` since `utils.ts` is identical
- `"test": "bun test"` in `package.json`
- Pure functions tested: `buildZendeskBase`, `buildZendeskAuth`, `parseWebhookPayload` (including JSON object, bare ticket ID, natural language, null cases, array edge case)
