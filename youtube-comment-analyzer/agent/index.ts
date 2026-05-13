import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { google } from 'googleapis';
import OpenAI from 'openai';
import {
  extractVideoId,
  normalizeSentiment,
  buildBatchUserMessage,
  parseJsonSentiments,
  formatReport,
} from './utils';
import type { SentimentResult } from './utils';

const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
const openai = new OpenAI();

// ---------------------------------------------------------------------------
// YouTube helpers
// ---------------------------------------------------------------------------

async function fetchComments(videoId: string, maxComments: number): Promise<string[]> {
  const comments: string[] = [];
  let pageToken: string | undefined;

  while (comments.length < maxComments) {
    const response = await youtube.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults: Math.min(100, maxComments - comments.length),
      pageToken,
      textFormat: 'plainText',
      order: 'relevance',
    });

    for (const item of response.data.items ?? []) {
      const text = item.snippet?.topLevelComment?.snippet?.textDisplay;
      if (text) comments.push(text);
      if (comments.length >= maxComments) break;
    }

    pageToken = response.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return comments;
}

// ---------------------------------------------------------------------------
// Sentiment analysis — batched to minimise OpenAI calls
// ---------------------------------------------------------------------------

const SENTIMENT_SYSTEM_PROMPT = [
  'Classify the sentiment of each comment.',
  'Return JSON: { "sentiments": ["positive"|"neutral"|"negative", ...] }',
  'The array must have exactly the same length as the input.',
  'positive — praise, excitement, appreciation, satisfaction',
  'negative — criticism, frustration, disappointment, hostility',
  'neutral  — questions, plain statements, mixed, or off-topic',
].join('\n');

async function analyzeBatch(comments: string[]): Promise<ReturnType<typeof normalizeSentiment>[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
      { role: 'user', content: buildBatchUserMessage(comments) },
    ],
  });
  const raw = response.choices[0].message.content ?? '';
  return parseJsonSentiments(raw);
}

async function analyzeAllComments(
  comments: string[],
  hooks: StreamHooks,
): Promise<SentimentResult[]> {
  const BATCH_SIZE = 30;
  const results: SentimentResult[] = [];

  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batch = comments.slice(i, i + BATCH_SIZE);
    const end = Math.min(i + BATCH_SIZE, comments.length);
    hooks.onChunk(`  Analysing comments ${i + 1}–${end} of ${comments.length}...\n`);

    const sentiments = await analyzeBatch(batch);
    for (let j = 0; j < batch.length; j++) {
      results.push({ comment: batch[j], sentiment: sentiments[j] ?? 'neutral' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const adapter: AgentAdapter = {
  name: 'youtube-comment-analyzer',

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    try {
      const videoId = extractVideoId(prompt.trim());
      if (!videoId) {
        hooks.onChunk(
          'Please provide a YouTube video URL or ID. Examples:\n' +
          '  https://www.youtube.com/watch?v=dQw4w9WgXcQ\n' +
          '  https://youtu.be/dQw4w9WgXcQ\n' +
          '  dQw4w9WgXcQ',
        );
        hooks.onFinish();
        return;
      }

      const numMatch = prompt.replace(videoId, '').match(/\b(\d+)\b/);
      const maxComments = numMatch ? parseInt(numMatch[1], 10) : 100;

      hooks.onChunk(`Fetching up to ${maxComments} comments for \`${videoId}\`...\n`);
      const comments = await fetchComments(videoId, maxComments);

      if (comments.length === 0) {
        hooks.onChunk('No comments found — comments may be disabled for this video.');
        hooks.onFinish();
        return;
      }

      hooks.onChunk(`Fetched ${comments.length} comment(s). Analysing sentiment...\n\n`);
      const results = await analyzeAllComments(comments, hooks);

      hooks.onChunk('\n' + formatReport(results, videoId));
      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },

  getConfig() {
    return {
      systemPrompt:
        'Analyses YouTube video comments and classifies each as positive, neutral, or negative. Returns a summary with counts, percentages, and examples.',
      tools: [],
    };
  },
};

serve(adapter);
