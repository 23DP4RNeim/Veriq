export interface ParsedTelegramCommand {
  command: string;
  arguments: string;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: (match[1] ?? '').toLowerCase(), arguments: (match[2] ?? '').trim() };
}
