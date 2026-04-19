import { spawn } from 'child_process';
import { getSessionId } from '../sessions';

export async function openCommand(chatId: string): Promise<void> {
  const sessionId = getSessionId(chatId);

  if (!sessionId) {
    console.error(`Nessuna sessione attiva per la chat: ${chatId}`);
    console.error('Usa "ai-teams-bridge sessions" per vedere le sessioni disponibili.');
    process.exit(1);
  }

  console.log(`Apertura sessione Claude per chat ${chatId}...`);
  console.log(`session: ${sessionId}\n`);

  const child = spawn('claude', ['--resume', sessionId], { stdio: 'inherit' });

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
