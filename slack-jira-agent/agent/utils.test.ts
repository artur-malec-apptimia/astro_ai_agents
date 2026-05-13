import { describe, expect, test } from 'bun:test';
import { parseSlackThreadUrl } from './utils';

// ---------------------------------------------------------------------------
// parseSlackThreadUrl
// ---------------------------------------------------------------------------

describe('parseSlackThreadUrl', () => {
  test('parses a standard Slack thread URL', () => {
    const result = parseSlackThreadUrl(
      'https://myworkspace.slack.com/archives/C1234567890/p1234567890123456',
    );
    expect(result).toEqual({ channel: 'C1234567890', threadTs: '1234567890.123456' });
  });

  test('reconstructs timestamp with dot at correct position', () => {
    // raw = 1706123456789012 → 1706123456.789012
    const result = parseSlackThreadUrl(
      'https://workspace.slack.com/archives/CABC123/p1706123456789012',
    );
    expect(result?.threadTs).toBe('1706123456.789012');
  });

  test('extracts channel ID correctly', () => {
    const result = parseSlackThreadUrl(
      'https://workspace.slack.com/archives/CABC123/p1706123456789012',
    );
    expect(result?.channel).toBe('CABC123');
  });

  test('works with URLs that have query parameters', () => {
    const result = parseSlackThreadUrl(
      'https://workspace.slack.com/archives/C1234567890/p1234567890123456?thread_ts=1234567890.123456&cid=C1234567890',
    );
    expect(result).not.toBeNull();
    expect(result?.channel).toBe('C1234567890');
  });

  test('is case-insensitive for the slack.com domain', () => {
    const result = parseSlackThreadUrl(
      'https://workspace.SLACK.COM/archives/C1234567890/p1234567890123456',
    );
    expect(result).not.toBeNull();
  });

  test('returns null for plain text', () => {
    expect(parseSlackThreadUrl('the login button is broken')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseSlackThreadUrl('')).toBeNull();
  });

  test('returns null for a non-Slack URL', () => {
    expect(parseSlackThreadUrl('https://github.com/org/repo/issues/123')).toBeNull();
  });

  test('returns null for a Slack URL missing the message segment', () => {
    expect(parseSlackThreadUrl('https://workspace.slack.com/archives/C1234567890')).toBeNull();
  });

  test('returns null when the timestamp segment has no digits', () => {
    expect(parseSlackThreadUrl('https://workspace.slack.com/archives/C1234567890/pabc')).toBeNull();
  });

  test('produces malformed threadTs for unrealistically short digit sequences', () => {
    const result = parseSlackThreadUrl('https://workspace.slack.com/archives/C123/p123');
    // matches regex but timestamp is malformed — documents known edge case
    expect(result?.threadTs).toBe('.123');
  });
});
