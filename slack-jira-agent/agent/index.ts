import { serve, type AgentAdapter, type StreamHooks, type StreamOptions } from "@astropods/adapter-core";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface JiraTicket {
  title: string;
  description: string;
}

interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
}

// Parses a Slack thread URL into channel and thread_ts.
// Supports: https://{workspace}.slack.com/archives/{channel}/p{ts_no_dot}
function parseSlackThreadUrl(input: string): { channel: string; threadTs: string } | null {
  const match = input.match(/slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/i);
  if (!match) return null;
  const channel = match[1];
  const raw = match[2];
  const threadTs = `${raw.slice(0, -6)}.${raw.slice(-6)}`;
  return { channel, threadTs };
}

async function fetchSlackThread(channel: string, threadTs: string): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  const response = await axios.get("https://slack.com/api/conversations.replies", {
    headers: { Authorization: `Bearer ${token}` },
    params: { channel, ts: threadTs },
  });

  if (!response.data.ok) {
    throw new Error(`Slack API error: ${response.data.error}`);
  }

  const messages: SlackMessage[] = response.data.messages ?? [];
  return messages
    .map((m) => m.text ?? "")
    .filter(Boolean)
    .join("\n");
}

async function postSlackReply(channel: string, threadTs: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, thread_ts: threadTs, text },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );

  if (!response.data.ok) {
    throw new Error(`Slack post error: ${response.data.error}`);
  }
}

async function generateJiraTicket(message: string): Promise<JiraTicket> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a project manager creating Jira tickets. Based on the following problem description or Slack thread, generate a concise Jira ticket title and a detailed description.

Respond ONLY with a JSON object — no markdown, no explanation, no code fences:
{
  "title": "Short, actionable ticket title (max 100 chars)",
  "description": "Detailed description of the issue, including context, steps to reproduce if applicable, and expected vs actual behavior"
}

Message/Thread:
${message}`,
      },
      {
        role: "assistant",
        content: "{",
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  const raw = `{${content.text}`;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from Claude response. Raw: ${raw.slice(0, 300)}`);
  }

  return JSON.parse(jsonMatch[0]) as JiraTicket;
}

async function createJiraTicket(ticket: JiraTicket): Promise<string> {
  const subdomain = process.env.JIRA_SUBDOMAIN;
  const username = process.env.JIRA_USERNAME;
  const apiKey = process.env.JIRA_API_KEY;
  const projectId = process.env.JIRA_PROJECT_ID;

  if (!subdomain || !username || !apiKey || !projectId) {
    throw new Error(
      "Missing required Jira environment variables: JIRA_SUBDOMAIN, JIRA_USERNAME, JIRA_API_KEY, JIRA_PROJECT_ID"
    );
  }

  const baseUrl = `https://${subdomain}.atlassian.net`;
  const credentials = Buffer.from(`${username}:${apiKey}`).toString("base64");

  const response = await axios.post(
    `${baseUrl}/rest/api/3/issue`,
    {
      fields: {
        project: { key: projectId },
        summary: ticket.title,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: ticket.description,
                },
              ],
            },
          ],
        },
        issuetype: { name: "Task" },
      },
    },
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const issueKey: string = response.data.key;
  return `${baseUrl}/browse/${issueKey}`;
}

const adapter: AgentAdapter = {
  name: "slack-jira-agent",

  getConfig() {
    return {
      systemPrompt: "Converts Slack problem descriptions or thread content into Jira tickets using Claude Haiku.",
      tools: [],
    };
  },

  async stream(prompt: string, hooks: StreamHooks, _options: StreamOptions): Promise<void> {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const slackThread = slackToken ? parseSlackThreadUrl(prompt) : null;

    // --- Slack mode: fetch thread and reply back ---
    let context = prompt;
    if (slackThread) {
      await hooks.onChunk("Fetching Slack thread...\n");
      try {
        context = await fetchSlackThread(slackThread.channel, slackThread.threadTs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        hooks.onError(new Error(`Error fetching Slack thread: ${msg}`));
        return;
      }
    }

    // --- Generate ticket from context ---
    await hooks.onChunk("Analyzing the message and generating a Jira ticket...\n");

    let ticket: JiraTicket;
    try {
      ticket = await generateJiraTicket(context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hooks.onError(new Error(`Error generating ticket content: ${msg}`));
      return;
    }

    await hooks.onChunk(`Generated ticket:\n- Title: ${ticket.title}\n\nCreating ticket in Jira...\n`);

    // --- Create Jira ticket ---
    let ticketUrl: string;
    try {
      ticketUrl = await createJiraTicket(ticket);
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (axios.isAxiosError(err) && err.response) {
        msg += ` — Jira response: ${JSON.stringify(err.response.data)}`;
      }
      hooks.onError(new Error(`Error creating Jira ticket: ${msg}`));
      return;
    }

    // --- Reply in Slack thread (if applicable) ---
    if (slackThread) {
      try {
        await postSlackReply(slackThread.channel, slackThread.threadTs, `Jira ticket created: ${ticketUrl}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await hooks.onChunk(`Warning: could not post reply to Slack thread: ${msg}\n`);
      }
    }

    await hooks.onChunk(`Jira ticket created successfully: ${ticketUrl}`);
    hooks.onFinish();
  },
};

serve(adapter);
