import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_DIR, SESSIONS_FILE } from './config';

interface SessionsFile {
  [chatId: string]: string;
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function read(): SessionsFile {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as SessionsFile;
  } catch {
    return {};
  }
}

function write(data: SessionsFile): void {
  ensureDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function getSessionId(chatId: string): string | undefined {
  return read()[chatId];
}

export function setSessionId(chatId: string, sessionId: string): void {
  const data = read();
  data[chatId] = sessionId;
  write(data);
}

export function clearSessionId(chatId: string): void {
  const data = read();
  delete data[chatId];
  write(data);
}
