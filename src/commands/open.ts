import { spawn } from 'child_process';
import { getSessionId } from '../sessions';

export async function openCommand(chatId: string): Promise<void> {
  const sessionId = getSessionId(chatId);

  const args = sessionId ? ['--resume', sessionId] : [];

  if (sessionId) {
    console.log(`Apertura sessione Claude per chat ${chatId}...`);
    console.log(`session: ${sessionId}\n`);
  } else {
    console.log(`Nessuna sessione attiva per la chat ${chatId}. Avvio nuova sessione Claude...\n`);
  }

  const child = spawn('claude', args, { stdio: 'inherit' });

  child.on('error', (err: any) => {
    if (err.code === 'ENOENT') {
      console.error('Comando "claude" non trovato. Assicurati che Claude Code sia installato e nel PATH.');
    } else {
      console.error('Errore avvio Claude:', err.message);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
