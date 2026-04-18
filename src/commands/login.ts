import { loadConfig } from '../config';
import { getFirebaseApp } from '../firebase';
import { runLoopbackOAuth, saveRefreshToken, signInFirebaseWithGoogle } from '../auth';

export async function loginCommand(): Promise<void> {
  const config = loadConfig();
  const tokens = await runLoopbackOAuth(config.oauth);
  if (!tokens.refresh_token) {
    console.error(
      'Google non ha restituito un refresh token. Rimuovi la concessione precedente su https://myaccount.google.com/permissions e riprova.',
    );
    process.exit(1);
  }
  await saveRefreshToken(tokens.refresh_token);

  const app = getFirebaseApp(config.firebase);
  const user = await signInFirebaseWithGoogle(app, tokens.id_token);
  console.log(`\nLogin completato come: ${user.email} (uid: ${user.uid})`);
  console.log(`Puoi ora avviare il bridge: ai-teams-bridge start`);
}
