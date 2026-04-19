#!/usr/bin/env node
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: path.join(__dirname, '..', '.env') });

import { Command } from 'commander';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { startCommand } from './commands/start';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('ai-teams-bridge')
  .description('Ponte locale tra AI Teams (chat) e Claude Code sulla tua macchina')
  .version('0.1.0');

program
  .command('login')
  .description('Autentica questo bridge come il tuo utente AI Teams (OAuth Google)')
  .action(async () => {
    try {
      await loginCommand();
    } catch (e: any) {
      console.error('login fallito:', e.message ?? e);
      process.exit(1);
    }
  });

program
  .command('logout')
  .description('Rimuove il token di login dal Keychain')
  .action(async () => {
    await logoutCommand();
  });

program
  .command('start')
  .description('Avvia il bridge: resta in ascolto dei tuoi /claude dalle chat')
  .action(async () => {
    try {
      await startCommand();
    } catch (e: any) {
      console.error('bridge fermato:', e.message ?? e);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Mostra stato del bridge: config, login, sessioni')
  .action(async () => {
    await statusCommand();
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
