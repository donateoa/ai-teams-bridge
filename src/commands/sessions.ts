import * as fs from 'fs';
import { SESSIONS_FILE } from '../config';

export function sessionsCommand(): void {
  if (!fs.existsSync(SESSIONS_FILE)) {
    console.log('Nessuna sessione Claude attiva.');
    return;
  }

  let data: Record<string, string> = {};
  try {
    data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    console.log('Impossibile leggere le sessioni.');
    return;
  }

  const entries = Object.entries(data);
  if (entries.length === 0) {
    console.log('Nessuna sessione Claude attiva.');
    return;
  }

  console.log('\nSessioni Claude attive:\n');
  for (const [chatId, sessionId] of entries) {
    console.log(`  chatId:    ${chatId}`);
    console.log(`  sessionId: ${sessionId}`);
    console.log(`  apri con:  ai-teams-bridge open ${chatId}\n`);
  }
}
