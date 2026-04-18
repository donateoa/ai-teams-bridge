import * as fs from 'fs';
import { loadConfig, SESSIONS_FILE, DEVICE_FILE } from '../config';
import { loadRefreshToken } from '../auth';
import { getDeviceId } from '../device';

export async function statusCommand(): Promise<void> {
  let cfgOk = false;
  try {
    loadConfig();
    cfgOk = true;
  } catch (e: any) {
    console.log('Config:   ERROR —', e.message);
  }
  if (cfgOk) console.log('Config:   OK (variabili ambiente presenti)');

  const token = await loadRefreshToken();
  console.log(`Login:    ${token ? 'OK (refresh token presente)' : 'NON loggato (esegui: ai-teams-bridge login)'}`);

  console.log(`Device:   ${getDeviceId()}`);
  console.log(`Device file: ${DEVICE_FILE}`);

  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, string>;
      const n = Object.keys(sessions).length;
      console.log(`Sessioni Claude: ${n} chat hanno una sessione attiva`);
      for (const [chatId, sid] of Object.entries(sessions)) {
        console.log(`  - chat ${chatId} -> session ${sid.slice(0, 8)}...`);
      }
    } catch {
      console.log('Sessioni Claude: file corrotto');
    }
  } else {
    console.log('Sessioni Claude: nessuna (file non esiste)');
  }
}
