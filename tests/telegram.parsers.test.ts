import { describe, expect, it } from 'vitest';
import { parseTelegramCommand } from '../src/channels/telegram/telegram.parsers.js';

describe('Telegram command parsing', () => {
  it('parses commands, bot mentions, and query arguments', () => {
    expect(parseTelegramCommand('/check@veriq_bot SIA Baltic Example')).toEqual({ command: 'check', arguments: 'SIA Baltic Example' });
  });

  it('handles a command without arguments and ignores ordinary text', () => {
    expect(parseTelegramCommand('/check')).toEqual({ command: 'check', arguments: '' });
    expect(parseTelegramCommand('40103999999')).toBeNull();
  });
});
