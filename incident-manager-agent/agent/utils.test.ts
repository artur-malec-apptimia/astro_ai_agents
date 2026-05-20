import { describe, expect, test, spyOn, afterEach } from 'bun:test';
import {
  slackHeaders,
  createSlackChannel,
  joinSlackChannel,
  inviteToSlackChannel,
  getSlackChannelMessages,
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
