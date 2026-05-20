# Trip Planner Agent — OpenAI Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the AI provider in `trip-planner-agent` from Anthropic (`claude-sonnet-4-6`) to OpenAI (`gpt-4.1`).

**Architecture:** In-place provider swap — update the SDK import and agentic loop in `index.ts`, convert tool definitions to OpenAI format in `definitions.ts`, swap the model entry in `astropods.yml`, and update `package.json`. The `executor.ts` and all tool files are untouched. All 33 existing tests continue to pass without modification.

**Tech Stack:** Bun, TypeScript, `openai` npm package, `@astropods/adapter-core`, bun:test

---

## File Map

| File | Action | Change |
|---|---|---|
| `trip-planner-agent/package.json` | Modify | Replace `@anthropic-ai/sdk` with `openai` |
| `trip-planner-agent/agent/tools/definitions.ts` | Modify | Convert `Anthropic.Tool[]` → `OpenAI.Chat.ChatCompletionTool[]` |
| `trip-planner-agent/agent/index.ts` | Modify | Swap SDK + rewrite agentic loop |
| `trip-planner-agent/astropods.yml` | Modify | `models.anthropic` → `models.openai` |

---

## Task 1: Swap dependency in package.json

**Files:**
- Modify: `trip-planner-agent/package.json`

- [ ] **Step 1: Update package.json**

Open `trip-planner-agent/package.json`. Replace:
```json
"@anthropic-ai/sdk": "latest"
```
with:
```json
"openai": "^4.0.0"
```

The full `dependencies` block should look like:
```json
"dependencies": {
  "@astropods/adapter-core": "latest",
  "openai": "^4.0.0"
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /c/astro_ai_agents/trip-planner-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun install
```

Expected: `bun install` completes, `openai` package appears in `node_modules`, `@anthropic-ai/sdk` is gone.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add trip-planner-agent/package.json && git commit -m "swap @anthropic-ai/sdk for openai in trip-planner-agent"
```

---

## Task 2: Convert tool definitions to OpenAI format

**Files:**
- Modify: `trip-planner-agent/agent/tools/definitions.ts`

- [ ] **Step 1: Rewrite definitions.ts**

Replace the entire content of `trip-planner-agent/agent/tools/definitions.ts` with:

```typescript
import type OpenAI from 'openai';

export const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_todays_date',
      description:
        "Returns today's date and day of week. Use this to determine whether trip dates are in the past (use historical weather) or future (use forecast).",
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
      name: 'get_weather_forecast',
      description:
        'Gets weather forecast for future dates at a location. Resolve city names to latitude/longitude from your training knowledge.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude of the destination' },
          longitude: { type: 'number', description: 'Longitude of the destination' },
          start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        },
        required: ['latitude', 'longitude', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_historical_weather',
      description: 'Gets historical weather data for past dates at a location.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude of the destination' },
          longitude: { type: 'number', description: 'Longitude of the destination' },
          start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        },
        required: ['latitude', 'longitude', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_yelp',
      description:
        'Searches Yelp for local businesses, activities, and restaurants at the destination. Call multiple times for different categories (e.g. "restaurants", "museums", "outdoor activities").',
      parameters: {
        type: 'object',
        properties: {
          term: {
            type: 'string',
            description: 'Search term e.g. "restaurants", "museums", "outdoor activities"',
          },
          location: { type: 'string', description: 'City or address to search near' },
          limit: { type: 'number', description: 'Max results to return (1-50)' },
        },
        required: ['term', 'location', 'limit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_notion_trip_plan_template',
      description:
        'Creates a Notion page with a Trip Schedule database and Packing List. Call this FIRST before adding daily entries. Returns trip_page_id and trip_schedule_database_id needed for subsequent calls.',
      parameters: {
        type: 'object',
        properties: {
          trip_page_title: {
            type: 'string',
            description: 'Title for the trip page e.g. "Paris Trip - June 2025"',
          },
          packing_list: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of items to pack for the trip',
          },
        },
        required: ['trip_page_title', 'packing_list'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_weather_to_notion_database',
      description:
        "Adds a single day's entry to the Notion trip schedule database. Call once per day of the trip after create_notion_trip_plan_template.",
      parameters: {
        type: 'object',
        properties: {
          trip_schedule_database_id: {
            type: 'string',
            description: 'Database ID returned by create_notion_trip_plan_template',
          },
          day_of_week: { type: 'string', description: 'e.g. "Monday"' },
          trip_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          weather_summary: { type: 'string', description: 'Weather description for the day' },
          activities_planned: { type: 'string', description: 'Activities planned for the day' },
          dining_plan: { type: 'string', description: 'Dining plans for the day' },
        },
        required: [
          'trip_schedule_database_id',
          'day_of_week',
          'trip_date',
          'weather_summary',
          'activities_planned',
          'dining_plan',
        ],
      },
    },
  },
];
```

- [ ] **Step 2: Run tests — verify all pass**

```bash
cd /c/astro_ai_agents/trip-planner-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `33 pass, 0 fail` (tests mock tool functions directly and don't touch definitions.ts).

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add trip-planner-agent/agent/tools/definitions.ts && git commit -m "convert tool definitions to OpenAI format in trip-planner-agent"
```

---

## Task 3: Rewrite index.ts with OpenAI agentic loop

**Files:**
- Modify: `trip-planner-agent/agent/index.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace the entire content of `trip-planner-agent/agent/index.ts` with:

```typescript
import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import OpenAI from 'openai';
import { TOOL_DEFINITIONS } from './tools/definitions.js';
import { executeTool } from './executor.js';

const openai = new OpenAI();

const SYSTEM_PROMPT =
  'You are a trip planning agent. Use the tools available to you to plan a trip and fulfill the user request. Make sure to use all info to account for how to best answer their question.';

const MAX_ITERATIONS = 20;

const adapter: AgentAdapter = {
  name: 'Trip Planner',

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1',
          max_tokens: 4096,
          tools: TOOL_DEFINITIONS,
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
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
              });
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

      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },

  getConfig() {
    return {
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
    };
  },
};

serve(adapter);
```

- [ ] **Step 2: Run tests — verify all still pass**

```bash
cd /c/astro_ai_agents/trip-planner-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `33 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add trip-planner-agent/agent/index.ts && git commit -m "migrate trip-planner-agent agentic loop from Anthropic to OpenAI gpt-4.1"
```

---

## Task 4: Update astropods.yml and verify

**Files:**
- Modify: `trip-planner-agent/astropods.yml`

- [ ] **Step 1: Update astropods.yml**

In `trip-planner-agent/astropods.yml`, replace:

```yaml
models:
  anthropic:
    provider: anthropic
```

with:

```yaml
models:
  openai:
    provider: openai
```

- [ ] **Step 2: Run tests one final time**

```bash
cd /c/astro_ai_agents/trip-planner-agent && /c/Users/artur/AppData/Roaming/sst/bin/bun test
```

Expected: `33 pass, 0 fail`.

- [ ] **Step 3: Commit**

```bash
cd /c/astro_ai_agents && git add trip-planner-agent/astropods.yml && git commit -m "switch trip-planner-agent to openai model provider in astropods.yml"
```
