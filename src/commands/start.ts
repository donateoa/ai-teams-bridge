import { loadConfig } from '../config';
import { getDb, getFirebaseApp } from '../firebase';
import {
  loadRefreshToken,
  refreshGoogleIdToken,
  signInFirebaseWithGoogle,
} from '../auth';
import { startListener } from '../listener';
import { getDeviceId } from '../device';

export async function startCommand(): Promise<void> {
  const config = loadConfig();

  const refreshToken = await loadRefreshToken();
  if (!refreshToken) {
    console.error('Non sei loggato. Esegui prima: ai-teams-bridge login');
    process.exit(1);
  }

  const app = getFirebaseApp(config.firebase);
  const tokens = await refreshGoogleIdToken(config.oauth, refreshToken);
  const user = await signInFirebaseWithGoogle(app, tokens.id_token);

  const db = getDb(config.firebase);
  const deviceId = getDeviceId();

  console.log(`\nai-teams-bridge attivo`);
  console.log(`  utente: ${user.email}`);
  console.log(`  uid:    ${user.uid}`);
  console.log(`  device: ${deviceId}`);
  console.log(`  mode:   permissionMode=${config.defaultPermissionMode}`);
  console.log(`\nIn ascolto di /claude ... dalle tue chat. Premi Ctrl-C per fermare.\n`);

  const unsub = startListener(db, config, user.uid);

  const shutdown = () => {
    console.log('\nChiusura bridge...');
    unsub();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}
