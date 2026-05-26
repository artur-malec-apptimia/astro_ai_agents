import { describe, expect, test, spyOn, afterEach } from 'bun:test';
import {
  refreshZoomToken,
  getZoomTranscript,
  buildZendeskAuth,
  createZendeskTicket,
  createNotionPage,
} from './utils';

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies.length = 0;
});

describe('refreshZoomToken', () => {
  test('returns access_token on success', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'zoom_tok_abc' }), { status: 200 }),
    );
    spies.push(spy);
    const token = await refreshZoomToken('client-id', 'client-secret', 'refresh-tok');
    expect(token).toBe('zoom_tok_abc');
  });

  test('POSTs to the Zoom token endpoint', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
    );
    spies.push(spy);
    await refreshZoomToken('id', 'secret', 'refresh');
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('zoom.us/oauth/token');
    expect((opts.headers as Record<string, string>)['Authorization']).toMatch(/^Basic /);
  });

  test('sends Basic auth with base64 clientId:clientSecret', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
    );
    spies.push(spy);
    await refreshZoomToken('myid', 'mysecret', 'refresh');
    const [, opts] = spy.mock.calls[0] as [string, RequestInit];
    const auth = (opts.headers as Record<string, string>)['Authorization'];
    const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8');
    expect(decoded).toBe('myid:mysecret');
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    spies.push(spy);
    await expect(refreshZoomToken('id', 'secret', 'refresh')).rejects.toThrow('401');
  });

  test('throws when access_token is missing', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 200 }),
    );
    spies.push(spy);
    await expect(refreshZoomToken('id', 'secret', 'refresh')).rejects.toThrow('access_token');
  });
});

describe('getZoomTranscript', () => {
  test('returns transcript text when TRANSCRIPT file is found', async () => {
    const mockRecordings = {
      recording_files: [
        { file_type: 'MP4', status: 'completed', download_url: 'https://zoom.us/mp4' },
        {
          file_type: 'TRANSCRIPT',
          status: 'completed',
          download_url: 'https://zoom.us/vtt',
        },
      ],
    };
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockRecordings), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('WEBVTT\n\nSpeaker: Hello world', { status: 200 }));
    spies.push(spy);
    const transcript = await getZoomTranscript('tok', '12345');
    expect(transcript).toContain('Hello world');
  });

  test('throws when no TRANSCRIPT file exists', async () => {
    const mockRecordings = {
      recording_files: [
        { file_type: 'MP4', status: 'completed', download_url: 'https://zoom.us/mp4' },
      ],
    };
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockRecordings), { status: 200 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript('tok', '12345')).rejects.toThrow('No completed transcript');
  });

  test('throws when TRANSCRIPT file is not completed', async () => {
    const mockRecordings = {
      recording_files: [
        { file_type: 'TRANSCRIPT', status: 'processing', download_url: 'https://zoom.us/vtt' },
      ],
    };
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockRecordings), { status: 200 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript('tok', '12345')).rejects.toThrow('No completed transcript');
  });

  test('throws when recordings fetch fails', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );
    spies.push(spy);
    await expect(getZoomTranscript('tok', 'bad-id')).rejects.toThrow('404');
  });

  test('throws when transcript download fails', async () => {
    const mockRecordings = {
      recording_files: [
        { file_type: 'TRANSCRIPT', status: 'completed', download_url: 'https://zoom.us/vtt' },
      ],
    };
    const spy = spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(mockRecordings), { status: 200 }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    spies.push(spy);
    await expect(getZoomTranscript('tok', '12345')).rejects.toThrow('403');
  });
});

describe('buildZendeskAuth', () => {
  test('returns base64-encoded email/token:apiKey', () => {
    const result = buildZendeskAuth('agent@example.com', 'myapikey');
    const decoded = Buffer.from(result, 'base64').toString('utf8');
    expect(decoded).toBe('agent@example.com/token:myapikey');
  });
});

describe('createZendeskTicket', () => {
  test('creates ticket and returns id and url', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 42 } }), { status: 201 }),
    );
    spies.push(spy);
    const result = await createZendeskTicket(
      'mycompany',
      'agent@example.com',
      'apikey',
      'Login broken',
      'Users cannot log in',
    );
    expect(result.ticket_id).toBe(42);
    expect(result.ticket_url).toBe('https://mycompany.zendesk.com/agent/tickets/42');
  });

  test('POSTs to the correct Zendesk endpoint', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ticket: { id: 1 } }), { status: 201 }),
    );
    spies.push(spy);
    await createZendeskTicket('myco', 'a@b.com', 'key', 'subject', 'desc');
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe('https://myco.zendesk.com/api/v2/tickets.json');
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    );
    spies.push(spy);
    await expect(
      createZendeskTicket('co', 'a@b.com', 'key', 'subj', 'desc'),
    ).rejects.toThrow('403');
  });
});

describe('createNotionPage', () => {
  test('creates page and returns url', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'page-123', url: 'https://notion.so/page-123' }),
        { status: 200 },
      ),
    );
    spies.push(spy);
    const result = await createNotionPage('api-key', 'parent-id', 'My Title', 'Content here');
    expect(result.page_url).toBe('https://notion.so/page-123');
  });

  test('POSTs to the Notion pages endpoint', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'p', url: 'https://notion.so/p' }), { status: 200 }),
    );
    spies.push(spy);
    await createNotionPage('key', 'parent', 'Title', 'Content');
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe('https://api.notion.com/v1/pages');
  });

  test('splits long content into 2000-char chunks', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'p', url: 'https://notion.so/p' }), { status: 200 }),
    );
    spies.push(spy);
    const longContent = 'x'.repeat(5000);
    await createNotionPage('key', 'parent', 'Title', longContent);
    const [, opts] = spy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { children: unknown[] };
    expect(body.children.length).toBe(3); // 5000 / 2000 = 3 chunks
  });

  test('throws on non-ok response', async () => {
    const spy = spyOn(global, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    spies.push(spy);
    await expect(createNotionPage('bad', 'parent', 'Title', 'Content')).rejects.toThrow('401');
  });
});
