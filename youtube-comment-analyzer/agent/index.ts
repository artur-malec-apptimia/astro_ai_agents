import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';

const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Sentiment = 'positive' | 'neutral' | 'negative';

interface SentimentResult {
  comment: string;
  sentiment: Sentiment;
}

// ---------------------------------------------------------------------------
// YouTube helpers
// ---------------------------------------------------------------------------

function extractVideoId(input: string): string | null {
  const short = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short) return short[1];

  const watch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch) return watch[1];

  const shorts = input.match(/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shorts) return shorts[1];

  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();

  return null;
}

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

function buildBatchUserMessage(comments: string[]): string {
  return JSON.stringify(comments.map((c, i) => `${i + 1}. ${c.slice(0, 300)}`));
}

const VALID_SENTIMENTS = new Set<string>(['positive', 'neutral', 'negative']);

function normalizeSentiment(value: unknown): Sentiment {
  const s = String(value ?? '').toLowerCase().trim();
  return VALID_SENTIMENTS.has(s) ? (s as Sentiment) : 'neutral';
}

function parseJsonSentiments(raw: string): Sentiment[] {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(clean) as { sentiments: unknown[] };
  return parsed.sentiments.map(normalizeSentiment);
}

async function analyzeBatch(comments: string[]): Promise<Sentiment[]> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SENTIMENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildBatchUserMessage(comments) }],
  });
  const raw = (response.content[0] as { type: 'text'; text: string }).text;
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
// Report
// ---------------------------------------------------------------------------

function formatReport(results: SentimentResult[], videoId: string): string {
  const counts: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  const examples: Record<Sentiment, string[]> = { positive: [], neutral: [], negative: [] };

  for (const r of results) {
    counts[r.sentiment]++;
    if (examples[r.sentiment].length < 3) {
      examples[r.sentiment].push(r.comment.slice(0, 160).replace(/\n/g, ' '));
    }
  }

  const total = results.length;
  const pct = (n: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';

  const section = (label: string, prefix: string, sentiment: Sentiment) => [
    `${label}  ${counts[sentiment]} comments (${pct(counts[sentiment])})`,
    ...examples[sentiment].map(e => `  ${prefix} "${e}"`),
  ];

  return [
    `YouTube Comment Sentiment Analysis`,
    `Video : https://youtube.com/watch?v=${videoId}`,
    `Total : ${total} comments analysed`,
    '='.repeat(65),
    '',
    ...section('POSITIVE', '+', 'positive'),
    '',
    ...section('NEUTRAL ', '~', 'neutral'),
    '',
    ...section('NEGATIVE', '-', 'negative'),
    '',
    '='.repeat(65),
  ].join('\n');
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
