import { serve } from '@astropods/adapter-core';
import type { AgentAdapter, StreamHooks, StreamOptions } from '@astropods/adapter-core';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Article {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Source fetchers
// ---------------------------------------------------------------------------

async function fetchNewsAPI(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://newsapi.org/v2/everything', {
    params: {
      q: topic,
      apiKey: process.env.NEWS_API_KEY,
      pageSize: 10,
      sortBy: 'publishedAt',
      language: 'en',
    },
  });
  return (data.articles ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `NewsAPI / ${a.source?.name ?? 'unknown'}`,
    publishedAt: a.publishedAt,
    description: a.description,
  }));
}

async function fetchGNews(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://gnews.io/api/v4/search', {
    params: {
      q: topic,
      token: process.env.GNEWS_API_KEY,
      max: 10,
      lang: 'en',
    },
  });
  return (data.articles ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `GNews / ${a.source?.name ?? 'unknown'}`,
    publishedAt: a.publishedAt,
    description: a.description,
  }));
}

async function fetchGuardian(topic: string): Promise<Article[]> {
  const { data } = await axios.get('https://content.guardianapis.com/search', {
    params: {
      q: topic,
      'api-key': process.env.GUARDIAN_API_KEY,
      'show-fields': 'headline,trailText',
      'page-size': 10,
      'order-by': 'newest',
    },
  });
  return (data.response?.results ?? []).map((a: Record<string, any>) => ({
    title: a.fields?.headline ?? a.webTitle,
    url: a.webUrl,
    source: 'The Guardian',
    publishedAt: a.webPublicationDate,
    description: a.fields?.trailText,
  }));
}

async function fetchMediaStack(topic: string): Promise<Article[]> {
  const { data } = await axios.get('http://api.mediastack.com/v1/news', {
    params: {
      keywords: topic,
      access_key: process.env.MEDIASTACK_API_KEY,
      limit: 10,
      languages: 'en',
      sort: 'published_desc',
    },
  });
  return (data.data ?? []).map((a: Record<string, any>) => ({
    title: a.title,
    url: a.url,
    source: `MediaStack / ${a.source ?? 'unknown'}`,
    publishedAt: a.published_at,
    description: a.description,
  }));
}

// ---------------------------------------------------------------------------
// Parallel fetch + dedup
// ---------------------------------------------------------------------------

const SOURCES: [string, (topic: string) => Promise<Article[]>][] = [
  ['NewsAPI', fetchNewsAPI],
  ['GNews', fetchGNews],
  ['The Guardian', fetchGuardian],
  ['MediaStack', fetchMediaStack],
];

async function fetchAll(topic: string, hooks: StreamHooks): Promise<Article[]> {
  const results = await Promise.allSettled(SOURCES.map(([, fn]) => fn(topic)));
  const all: Article[] = [];

  for (let i = 0; i < results.length; i++) {
    const [name] = SOURCES[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      hooks.onChunk(`  + ${name}: ${result.value.length} article(s)\n`);
      all.push(...result.value);
    } else {
      const msg = result.reason?.response?.data?.message ?? result.reason?.message ?? 'unknown error';
      hooks.onChunk(`  - ${name}: failed (${msg})\n`);
    }
  }

  return all;
}

function deduplicate(articles: Article[]): Article[] {
  const seen = new Set<string>();
  return articles.filter(a => {
    const key = a.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Format detection + summary
// ---------------------------------------------------------------------------

type OutputFormat = 'summary' | 'analysis' | 'key insights';

function detectFormat(text: string): { topic: string; format: OutputFormat } {
  const lower = text.toLowerCase();
  let format: OutputFormat = 'summary';

  if (lower.includes('analysis') || lower.includes('analyse') || lower.includes('analyze')) {
    format = 'analysis';
  } else if (lower.includes('key insight') || lower.includes('insights')) {
    format = 'key insights';
  }

  const topic = text
    .replace(/\b(summary|analysis|analyse|analyze|key insights?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { topic: topic || text.trim(), format };
}

const FORMAT_PROMPTS: Record<OutputFormat, string> = {
  summary: [
    'You are an industry analyst. Summarise the news into a concise briefing.',
    'Structure:',
    'KEY THEMES — 3 bullet points of the main trends',
    'TOP STORIES — the 3-5 most important articles, 1-sentence summary each with source and URL',
    'TAKEAWAY — 1 short paragraph with the overall picture',
  ].join('\n'),
  analysis: [
    'You are an industry analyst. Provide a deep analytical breakdown of the news.',
    'Structure:',
    'MARKET SIGNALS — 3-5 bullet points on what the news signals for the industry',
    'KEY PLAYERS — companies or people driving the narrative',
    'RISKS & OPPORTUNITIES — 2-3 points each',
    'ANALYST VERDICT — 1 paragraph conclusion with forward-looking perspective',
  ].join('\n'),
  'key insights': [
    'You are an industry analyst. Extract only the most actionable key insights.',
    'Structure:',
    'TOP INSIGHTS — 5-7 concise bullet points, each starting with an action verb',
    'WHAT TO WATCH — 2-3 trends or developments worth monitoring',
    'Be direct and specific. No fluff.',
  ].join('\n'),
};

async function summarize(topic: string, articles: Article[], format: OutputFormat): Promise<string> {
  const list = articles
    .slice(0, 20)
    .map(
      (a, i) =>
        `${i + 1}. [${a.source}] ${a.title}\n` +
        `   ${a.description?.slice(0, 200) ?? 'No description'}\n` +
        `   ${a.url}`,
    )
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: FORMAT_PROMPTS[format],
    messages: [{ role: 'user', content: `Topic: "${topic}"\n\nArticles:\n\n${list}` }],
  });

  return (response.content[0] as { type: 'text'; text: string }).text;
}

// ---------------------------------------------------------------------------
// Slack (optional)
// ---------------------------------------------------------------------------

async function postToSlack(text: string): Promise<void> {
  const token = process.env.SLACK_POSTING_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;

  const chunks = text.match(/[\s\S]{1,3000}/g) ?? [text];
  for (const chunk of chunks) {
    await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text: chunk },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const adapter: AgentAdapter = {
  name: 'industry-news-agent',

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    try {
      const raw_prompt = prompt.trim();
      if (!raw_prompt) {
        hooks.onChunk(
          'Please provide a topic and optional format. Examples:\n' +
          '  AI news\n' +
          '  startup funding analysis\n' +
          '  fintech key insights',
        );
        hooks.onFinish();
        return;
      }

      const { topic, format } = detectFormat(raw_prompt);
      hooks.onChunk(`Fetching news for "${topic}" (format: ${format})...\n\n`);

      const raw = await fetchAll(topic, hooks);
      const articles = deduplicate(raw);

      hooks.onChunk(
        `\nTotal: ${raw.length} articles fetched, ${articles.length} after deduplication.\n\n`,
      );

      if (articles.length === 0) {
        hooks.onChunk('No articles found for this topic.');
        hooks.onFinish();
        return;
      }

      hooks.onChunk('Analysing with Anthropic...\n\n');
      const summary = await summarize(topic, articles, format);

      hooks.onChunk(summary);

      if (process.env.SLACK_POSTING_TOKEN && process.env.SLACK_CHANNEL_ID) {
        hooks.onChunk(`\n\nPosting to Slack...`);
        await postToSlack(`*Industry news: ${topic}*\n\n${summary}`);
        hooks.onChunk(' Done.');
      }

      hooks.onFinish();
    } catch (error) {
      hooks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  },

  getConfig() {
    return {
      systemPrompt:
        'Monitors industry news across NewsAPI, GNews, The Guardian, and MediaStack. Deduplicates and summarises results using OpenAI.',
      tools: [],
    };
  },
};

serve(adapter);
