# Trip Planner Agent — OpenAI Provider Migration

**Date:** 2026-05-20
**Scope:** Swap the AI provider in `trip-planner-agent` from Anthropic (`claude-sonnet-4-6`) to OpenAI (`gpt-4.1`). File structure and test coverage are preserved unchanged.

---

## What Changes

| File | Change |
|---|---|
| `trip-planner-agent/package.json` | Replace `@anthropic-ai/sdk` with `openai` |
| `trip-planner-agent/agent/index.ts` | Swap SDK import and rewrite agentic loop |
| `trip-planner-agent/agent/tools/definitions.ts` | Convert tool schema to OpenAI format |
| `trip-planner-agent/astropods.yml` | `models.anthropic` → `models.openai` |

## What Does Not Change

- `agent/executor.ts` — tool dispatch logic is provider-agnostic
- `agent/tools/date.ts`, `weather.ts`, `yelp.ts`, `notion.ts` — no SDK dependency
- All test files — tests mock tool functions directly, no SDK involvement
- Directory structure — `tools/`, `executor.ts` pattern is preserved

---

## index.ts Agentic Loop

**Before (Anthropic):**
- SDK: `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`
- API call: `client.messages.create({ model: 'claude-sonnet-4-6', system: [...], tools, messages })`
- System prompt: passed as `system` array parameter with `cache_control`
- Loop break: `response.stop_reason === 'end_turn'`
- Tool detection: `response.stop_reason === 'tool_use'`
- Tool results: `{ type: 'tool_result', tool_use_id, content }` pushed as `role: 'user'` message
- Text chunks: iterate `response.content` blocks, emit `block.text` where `block.type === 'text'`

**After (OpenAI):**
- SDK: `new OpenAI()` (reads `OPENAI_API_KEY` from env automatically)
- API call: `openai.chat.completions.create({ model: 'gpt-4.1', max_tokens: 4096, tools, messages })`
- System prompt: `{ role: 'system', content: SYSTEM_PROMPT }` prepended to messages array
- Loop break: `response.choices[0].finish_reason === 'stop'`
- Tool detection: `response.choices[0].finish_reason === 'tool_calls'`
- Tool results: `{ role: 'tool', tool_call_id, content }` pushed as individual messages
- Text chunks: emit `response.choices[0].message.content` when present
- Push assistant message before tool results (same ordering requirement as Anthropic)

---

## Tool Definitions Format

**Before (Anthropic):**
```typescript
const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'get_todays_date',
    description: '...',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]
```

**After (OpenAI):**
```typescript
const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_todays_date',
      description: '...',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]
```

The JSON Schema inside `parameters` is identical to what was in `input_schema` — only the wrapper structure changes. The `cache_control` field on the last tool definition is removed (OpenAI has no equivalent).

---

## astropods.yml

```yaml
# Before
models:
  anthropic:
    provider: anthropic

# After
models:
  openai:
    provider: openai
```

`OPENAI_API_KEY` is auto-injected by Astropods — no new input entry needed.

---

## Testing

All 33 existing tests continue to pass without modification:
- `executor.test.ts` — mocks tool functions via `spyOn`, no SDK involvement
- `date.test.ts`, `weather.test.ts`, `yelp.test.ts`, `notion.test.ts` — test tool implementations only

After implementation, run `bun test` to confirm 33 pass, 0 fail.
