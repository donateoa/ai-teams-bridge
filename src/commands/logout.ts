import { clearRefreshToken } from '../auth';

export async function logoutCommand(): Promise<void> {
  await clearRefreshToken();
  console.log('Token rimosso dal Keychain. Puoi fare di nuovo login con: ai-teams-bridge login');
}
