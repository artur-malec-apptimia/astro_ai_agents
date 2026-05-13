import { serve, type AgentAdapter, type StreamHooks, type StreamOptions } from '@astropods/adapter-core';
import OpenAI from 'openai';
import axios from 'axios';
import { buildZendeskBase, buildZendeskAuth, parseWebhookPayload } from './utils';

const openai = new OpenAI();

// ---------------------------------------------------------------------------
// Zendesk helpers
// ---------------------------------------------------------------------------

function zendeskBase(): string {
  if (!process.env.ZENDESK_SUBDOMAIN) throw new Error('ZENDESK_SUBDOMAIN is not set');
  return buildZendeskBase(process.env.ZENDESK_SUBDOMAIN);
}

function zendeskAuth(): string {
  if (!process.env.ZENDESK_USERNAME) throw new Error('ZENDESK_USERNAME is not set');
  if (!process.env.ZENDESK_API_KEY) throw new Error('ZENDESK_API_KEY is not set');
  return buildZendeskAuth(process.env.ZENDESK_USERNAME, process.env.ZENDESK_API_KEY);
}

async function listZendeskTags(): Promise<{ name: string; count: number }[]> {
  const { data } = await axios.get(`${zendeskBase()}/tags`, {
    headers: { Authorization: `Basic ${zendeskAuth()}` },
  });
  return data.tags;
}

async function updateTicketTags(ticketId: string, tags: string[]): Promise<unknown> {
  const { data } = await axios.put(
    `${zendeskBase()}/tickets/${ticketId}/tags`,
    { tags },
    { headers: { Authorization: `Basic ${zendeskAuth()}`, 'Content-Type': 'application/json' } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// PagerDuty helpers
// ---------------------------------------------------------------------------

function pagerdutyHeaders(): Record<string, string> {
  if (!process.env.PAGERDUTY_API_KEY) throw new Error('PAGERDUTY_API_KEY is not set');
  if (!process.env.PAGERDUTY_FROM_EMAIL) throw new Error('PAGERDUTY_FROM_EMAIL is not set');
  return {
    Authorization: `Token token=${process.env.PAGERDUTY_API_KEY}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    From: process.env.PAGERDUTY_FROM_EMAIL,
    'Content-Type': 'application/json',
  };
}

async function listPagerdutyServices(): Promise<{ id: string; name: string }[]> {
  const { data } = await axios.get('https://api.pagerduty.com/services', {
    headers: pagerdutyHeaders(),
  });
  return data.services;
}

async function createPagerdutyIncident(
  serviceId: string,
  title: string,
  description: string,
): Promise<unknown> {
  const { data } = await axios.post(
    'https://api.pagerduty.com/incidents',
    {
      incident: {
        type: 'incident',
        title,
        service: { id: serviceId, type: 'service_reference' },
        body: { type: 'incident_body', details: description },
      },
    },
    { headers: pagerdutyHeaders() },
  );
  return data.incident;
}
