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
