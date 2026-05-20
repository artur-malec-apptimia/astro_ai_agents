# Migrate a Postman Agent to Astropods — Step-by-Step Prompt Guide

Use this document as a prompt (or reference) when migrating a Postman AI Agent to an Astropods agent using `@astropods/adapter-core`.

---

## Prerequisites

- [Bun](https://bun.sh/) installed globally
- [Astropods CLI](https://docs.astropods.com) (`ast`) installed
- Docker Desktop running (with WSL integration enabled if on Windows)
- A Postman agent to migrate (template URL + exported collection JSON)

---

## Step 1 — Gather Postman source material

Before writing any code, extract everything you need from Postman:

1. Open the Postman template page (e.g. `https://www.postman.com/templates/agents/trip-planner-agent/`)
2. Open the Flow in Postman AI Agent Builder
3. Take a screenshot or note down the **tool block names** wired into the agent
4. Export the collection as JSON via Postman → Collections → `...` → Export
   - The JSON reveals each tool's HTTP method, URL, headers, query params, and body schema — everything needed to reimplement the tool calls in TypeScript

> **Why export the JSON?** Postman flows are visual. The exported collection is machine-readable and shows the exact API calls the agent makes, which become your tool implementations.

---

## Step 2 — Scaffold the project

```bash
mkdir my-agent && cd my-agent
bun init -y
bun add @astropods/adapter-core @anthropic-ai/sdk
bun add -d typescript @types/bun
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["agent"]
}
```

Suggested folder structure:

```
my-agent/
├── agent/
│   ├── index.ts             # AgentAdapter entry point + agentic loop
│   ├── executor.ts          # dispatches Claude tool_use blocks to tool functions
│   └── tools/
│       ├── definitions.ts   # Claude tool schemas
│       ├── date.ts          # helper tools (no API key needed)
│       ├── weather.ts       # external API tools
│       ├── yelp.ts
│       └── notion.ts
├── astropods.yml
├── Dockerfile
├── AGENT.md
└── package.json
```

---

## Step 3 — Prepare `.gitignore`

Create `.gitignore` as **UTF-8** (important on Windows — editors sometimes save as UTF-16 which breaks git):

```
.env
node_modules/
dist/
bun.lock
*.tsbuildinfo
.ast/
```

> **Windows gotcha:** If using VS Code or another Windows editor, verify the file is saved as UTF-8 (not UTF-16 LE with BOM). Git silently fails to parse UTF-16 encoded `.gitignore` files, so `.env` ends up tracked. Use `Set-Content -Encoding utf8` in PowerShell or write it via a tool that guarantees UTF-8.

---

## Step 4 — Use the `migrate-to-astropods` skill

Invoke the **`migrate-to-astropods`** skill in Claude Code. It will:

1. Read your existing agent code to understand the runtime (Bun/Node/Python)
2. Generate `astropods.yml` — the Astropods package spec
3. Generate `Dockerfile` — containerises the agent

### `astropods.yml` key rules

- `inputs` must be a **map**, not a list:
  ```yaml
  # CORRECT
  inputs:
    MY_KEY:
      name: MY_KEY
      datatype: string
      secret: true
      description: "..."
      display-as: short-text

  # WRONG — will fail schema validation
  inputs:
    - name: MY_KEY
  ```
- LLM providers (Anthropic, OpenAI) go under `models:`, not `inputs:` — they are auto-injected:
  ```yaml
  models:
    anthropic:
      provider: anthropic
  ```
- Do **not** add a `meta.description` field — it is not in the schema (put descriptions in `AGENT.md` instead)

### `AGENT.md`

Create `AGENT.md` with YAML frontmatter for the Astropods playground display:

```markdown
---
description: "One-line description of what the agent does"
tags: ["tag1", "tag2"]
capabilities:
  - "Capability one"
  - "Capability two"
integrations:
  - "External service names"
---

# Agent Name

Longer description for users.

## Required configuration
...

## Example prompt
...
```

---

## Step 5 — Implement the agent

### `agent/tools/definitions.ts`

Define Claude tool schemas for every tool the Postman agent exposes. Add `cache_control: { type: 'ephemeral' }` to the **last** tool definition so Anthropic caches the tool list across turns:

```typescript
import Anthropic from '@anthropic-ai/sdk';

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'my_tool',
    description: 'What this tool does',
    input_schema: {
      type: 'object' as const,
      properties: {
        param1: { type: 'string', description: '...' },
      },
      required: ['param1'],
    },
  },
  // ... more tools ...
  {
    name: 'last_tool',
    description: '...',
    input_schema: { ... },
    // cache_control on the last tool caches the entire tool list
    cache_control: { type: 'ephemeral' },
  } as Anthropic.Tool & { cache_control: { type: 'ephemeral' } },
];
```

### `agent/executor.ts`

```typescript
import { myTool } from './tools/myTool.js';

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'my_tool':
      return JSON.stringify(await myTool(input.param1 as string));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

### `agent/index.ts` — agentic loop

```typescript
import { serve } from '@astropods/adapter-core';
import type { AgentAdapter } from '@astropods/adapter-core';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { TOOL_DEFINITIONS } from './tools/definitions.js';
import { executeTool } from './executor.js';

const SYSTEM_PROMPT = 'You are a ... agent. Use the tools available to you to ...';
const MAX_ITERATIONS = 20;

const adapter: AgentAdapter = {
  name: 'My Agent',
  async stream(prompt, hooks, _options) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: MessageParam[] = [{ role: 'user', content: prompt }];
    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: TOOL_DEFINITIONS,
          messages,
        });
        for (const block of response.content) {
          if (block.type === 'text' && block.text) hooks.onChunk(block.text);
        }
        if (response.stop_reason === 'end_turn') break;
        if (response.stop_reason === 'tool_use') {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;
            hooks.onChunk(`\n[Using: ${block.name}...]\n`);
            try {
              const result = await executeTool(block.name, block.input as Record<string, unknown>);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              });
            }
          }
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: toolResults });
        }
      }
      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },
  getConfig() { return { systemPrompt: SYSTEM_PROMPT, tools: [] }; },
};

serve(adapter);
```

---

## Step 6 — Write tests with Bun

Use `bun:test` with `mock()` for `global.fetch`. Run after each tool file:

```typescript
import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { myTool } from '../tools/myTool.js';

describe('myTool', () => {
  beforeEach(() => {
    process.env.MY_API_KEY = 'test-key';
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: 'ok' }),
      } as Response),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.MY_API_KEY;
  });

  test('calls the right endpoint', async () => {
    await myTool('input');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.example.com'),
      expect.anything(),
    );
  });
});
```

> **Spy leakage gotcha:** If you use `spyOn` in one test file, always restore mocks in `afterEach`:
> ```typescript
> afterEach(() => spies.forEach(s => s.mockRestore()));
> ```
> Without this, spied implementations leak into other test files run in the same process.

Run all tests:
```bash
bun test
```

---

## Step 7 — Test locally with `ast dev`

```bash
ast dev
```

Opens the playground at `http://localhost:3100`. Send a prompt and verify:
- Tool calls stream in real time (`[Using: tool_name...]`)
- The final answer is correct
- External integrations (Notion, Yelp, etc.) are hit with real data

**Windows + WSL requirement:**
- `ast dev` requires Docker. On Windows, Docker Desktop must be running with WSL integration enabled for your distro (Docker Desktop → Settings → Resources → WSL Integration → enable for your Ubuntu distro).
- Run `ast dev` from within WSL, not from a Windows PowerShell/CMD terminal.

---

## Step 8 — Test the uploaded blueprint

```bash
ast blueprint push my-agent
```

If you get schema validation errors:

| Error | Fix |
|---|---|
| `/meta: additional properties 'description' not allowed` | Remove `meta.description` from `astropods.yml` — put it in `AGENT.md` frontmatter |
| `/inputs: cannot unmarshal !!seq into map` | Change `inputs` from a list (`- name: KEY`) to a map (`KEY: { name: KEY, ... }`) |
| `ANTHROPIC_API_KEY` in inputs rejected | Use `models: anthropic: provider: anthropic` instead |

After a successful push, test the agent from the Astropods dashboard.

---

## Step 9 — Create a GitHub repo and push

```bash
git init
git add .
git commit -m "feat: initial trip planner agent"
git remote add origin https://github.com/your-org/your-repo.git
git branch -M main
git push -u origin main
```

Make sure `.gitignore` is in place **before** the first `git add` so `.env` is never staged.

---

## Step 10 — Add a README

Include:
- What the agent does (1–2 sentences)
- Tool table (tool name + description)
- Prerequisites and configuration (which env vars, where to get them)
- Local dev commands (`bun install`, `bun test`, `ast dev`)
- Example prompt
- Project structure tree

---

## Common Problems

### `.env` gets committed / tracked by git
**Cause:** `.gitignore` was saved as UTF-16 LE (Windows default) — git can't parse it.  
**Fix:** Recreate `.gitignore` explicitly as UTF-8. In PowerShell: `Set-Content -Encoding utf8 .gitignore`; or use Claude Code's Write tool which guarantees UTF-8.

### `ast dev` fails — Docker not found
**Cause:** Docker Desktop WSL integration not enabled for your Linux distro.  
**Fix:** Docker Desktop → Settings → Resources → WSL Integration → toggle on your distro → Apply & Restart.

### `ast blueprint push` fails — schema errors
**Cause:** `astropods.yml` uses unsupported fields or wrong formats.  
**Fix:** See the table in Step 8. Validate against the schema at `https://astropods.ai/schema/package.json`.

### `spyOn` mocks leak between test files
**Cause:** `bun test` runs files in the same process; spied modules stay patched.  
**Fix:** Add `afterEach(() => spies.forEach(s => s.mockRestore()))` in any test that uses `spyOn`.

### TypeScript error: `Mock` not assignable to `typeof fetch`
**Cause:** `bun:test` `mock()` return type doesn't overlap with the native `fetch` type.  
**Fix:** Cast assignments as `as unknown as typeof fetch` and reads as `as unknown as ReturnType<typeof mock>`.

### `ast` CLI not found in Claude Code / non-interactive shells
**Cause:** `ast` is installed in WSL but not on PATH for non-interactive sessions.  
**Fix:** Run `ast` commands directly in a WSL terminal, not through Claude Code's shell tool.

### Tools call each other's mock in tests (fetch mock state shared)
**Cause:** `global.fetch` is set in one `beforeEach` and not reset between describes.  
**Fix:** Always `delete` or reset `global.fetch` in `afterEach`, or use `beforeEach` in every `describe` block.
