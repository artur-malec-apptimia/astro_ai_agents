import { describe, expect, test, spyOn, afterEach } from 'bun:test';
import {
  slackHeaders,
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
  notionHeaders,
  fetchIncidentsFromNotion,
  createIncidentInNotion,
  updateIncidentInNotion,
} from './utils';

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies.length = 0;
});

describe('slackHeaders', () => {
  test('returns correct Authorization header', () => {
    const headers = slackHeaders('xoxb-test-token');
    expect(headers.Authorization).toBe('Bearer xoxb-test-token');
  });

  test('returns Content-Type application/json', () => {
    const headers = slackHeaders('token');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('createSlackChannel', () => {
  test('POSTs to conversations.create', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    await createSlackChannel('token', 'incident-db-down');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.create',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel name in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    await createSlackChannel('token', 'incident-db-down');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'incident-db-down' });
  });

  test('returns id and name', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, channel: { id: 'C123', name: 'incident-db-down' } }), { status: 200 }),
    );
    spies.push(spy);
    const result = await createSlackChannel('token', 'incident-db-down');
    expect(result).toEqual({ id: 'C123', name: 'incident-db-down' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'name_taken' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(createSlackChannel('token', 'taken')).rejects.toThrow('name_taken');
  });
});

describe('joinSlackChannel', () => {
  test('POSTs to conversations.join', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await joinSlackChannel('token', 'C123');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.join',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel id in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await joinSlackChannel('token', 'C123');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C123' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(joinSlackChannel('token', 'bad')).rejects.toThrow('channel_not_found');
  });
});

describe('inviteToSlackChannel', () => {
  test('POSTs to conversations.invite', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await inviteToSlackChannel('token', 'C123', 'U456');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.invite',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('sends channel and users in body', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    spies.push(spy);
    await inviteToSlackChannel('token', 'C123', 'U456');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C123', users: 'U456' });
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'already_in_channel' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(inviteToSlackChannel('token', 'C123', 'U456')).rejects.toThrow('already_in_channel');
  });
});

describe('getSlackChannelMessages', () => {
  test('GETs conversations.history with channel param', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: [] }), { status: 200 }),
    );
    spies.push(spy);
    await getSlackChannelMessages('token', 'C123');
    expect(spy).toHaveBeenCalledWith(
      'https://slack.com/api/conversations.history?channel=C123',
      expect.anything(),
    );
  });

  test('returns array of messages', async () => {
    const msgs = [{ ts: '1234.5678', user: 'U1', text: 'DB is down' }];
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messages: msgs }), { status: 200 }),
    );
    spies.push(spy);
    const result = await getSlackChannelMessages('token', 'C123');
    expect(result).toEqual(msgs);
  });

  test('throws when Slack returns ok: false', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'not_in_channel' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(getSlackChannelMessages('token', 'C123')).rejects.toThrow('not_in_channel');
  });
});

describe('notionHeaders', () => {
  test('returns correct Authorization header', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers.Authorization).toBe('Bearer secret_abc');
  });

  test('returns Notion-Version header', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers['Notion-Version']).toBe('2022-06-28');
  });

  test('returns Content-Type application/json', () => {
    const headers = notionHeaders('secret_abc');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('fetchIncidentsFromNotion', () => {
  test('POSTs to the database query endpoint', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    spies.push(spy);
    await fetchIncidentsFromNotion('secret_abc', 'db-123');
    expect(spy).toHaveBeenCalledWith(
      'https://api.notion.com/v1/databases/db-123/query',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('maps results to IncidentRecord array', async () => {
    const mockPage = {
      id: 'page-1',
      properties: {
        Name: { title: [{ plain_text: 'DB Outage' }] },
        Status: { select: { name: 'In progress' } },
        'Severity Level': { select: { name: 'Critical' } },
        'Incident Date': { date: { start: '2026-05-20' } },
        'Slack Channel ID': { rich_text: [{ plain_text: 'C123456' }] },
      },
    };
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [mockPage] }), { status: 200 }),
    );
    spies.push(spy);
    const result = await fetchIncidentsFromNotion('secret_abc', 'db-123');
    expect(result).toEqual([
      {
        page_id: 'page-1',
        name: 'DB Outage',
        status: 'In progress',
        severity_level: 'Critical',
        incident_date: '2026-05-20',
        slack_channel_id: 'C123456',
      },
    ]);
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    spies.push(spy);
    await expect(fetchIncidentsFromNotion('bad', 'db')).rejects.toThrow('401');
  });
});

describe('createIncidentInNotion', () => {
  test('POSTs to /v1/pages', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'new-page-id' }), { status: 200 }),
    );
    spies.push(spy);
    await createIncidentInNotion('secret', 'db-123', {
      name: 'DB Outage',
      incident_date: '2026-05-20',
      status: 'In progress',
      severity_level: 'Critical',
      detail_summary: 'DB is down',
      engineering_update: 'Investigating',
      support_update: 'Users affected',
      slack_channel_id: 'C123',
    });
    expect(spy).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('returns page_id from response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'new-page-id' }), { status: 200 }),
    );
    spies.push(spy);
    const result = await createIncidentInNotion('secret', 'db-123', {
      name: 'DB Outage',
      incident_date: '2026-05-20',
      status: 'In progress',
      severity_level: 'Critical',
      detail_summary: 'DB is down',
      engineering_update: 'Investigating',
      support_update: 'Users affected',
      slack_channel_id: 'C123',
    });
    expect(result).toEqual({ page_id: 'new-page-id' });
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Bad Request', { status: 400 }),
    );
    spies.push(spy);
    await expect(
      createIncidentInNotion('secret', 'db', {
        name: 'x', incident_date: '2026-05-20', status: 'In progress',
        severity_level: 'Low', detail_summary: 'x', engineering_update: 'x',
        support_update: 'x', slack_channel_id: 'C1',
      }),
    ).rejects.toThrow('400');
  });
});

describe('updateIncidentInNotion', () => {
  test('PATCHes the page properties', async () => {
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    await updateIncidentInNotion('secret', 'page-1', {
      status: 'Done',
      severity_level: 'High',
      detail_summary: 'Resolved',
      engineering_update: 'Fixed',
      support_update: 'All clear',
    });
    const [firstUrl, firstInit] = spy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe('https://api.notion.com/v1/pages/page-1');
    expect((firstInit as RequestInit).method).toBe('PATCH');
  });

  test('returns page_id', async () => {
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    spies.push(spy);
    const result = await updateIncidentInNotion('secret', 'page-1', {
      status: 'Done',
      severity_level: 'High',
      detail_summary: 'Resolved',
      engineering_update: 'Fixed',
      support_update: 'All clear',
    });
    expect(result).toEqual({ page_id: 'page-1' });
  });
});
