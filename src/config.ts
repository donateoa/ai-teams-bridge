import * as path from 'path';
import * as os from 'os';

export const APP_NAME = 'ai-teams-bridge';
export const KEYCHAIN_SERVICE = 'ai-teams-bridge';
export const KEYCHAIN_ACCOUNT_REFRESH = 'google-refresh-token';

export const CONFIG_DIR = path.join(os.homedir(), '.ai-teams');
export const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');
export const DEVICE_FILE = path.join(CONFIG_DIR, 'device.json');

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface BridgeConfig {
  firebase: FirebaseConfig;
  oauth: GoogleOAuthConfig;
  defaultPermissionMode: 'plan' | 'acceptEdits' | 'default';
}

export function loadConfig(): BridgeConfig {
  const {
    AI_TEAMS_FIREBASE_API_KEY,
    AI_TEAMS_FIREBASE_AUTH_DOMAIN,
    AI_TEAMS_FIREBASE_PROJECT_ID,
    AI_TEAMS_FIREBASE_APP_ID,
    AI_TEAMS_FIREBASE_STORAGE_BUCKET,
    AI_TEAMS_FIREBASE_MESSAGING_SENDER_ID,
    AI_TEAMS_GOOGLE_CLIENT_ID,
    AI_TEAMS_GOOGLE_CLIENT_SECRET,
    AI_TEAMS_PERMISSION_MODE,
  } = process.env;

  const missing: string[] = [];
  if (!AI_TEAMS_FIREBASE_API_KEY) missing.push('AI_TEAMS_FIREBASE_API_KEY');
  if (!AI_TEAMS_FIREBASE_AUTH_DOMAIN) missing.push('AI_TEAMS_FIREBASE_AUTH_DOMAIN');
  if (!AI_TEAMS_FIREBASE_PROJECT_ID) missing.push('AI_TEAMS_FIREBASE_PROJECT_ID');
  if (!AI_TEAMS_FIREBASE_APP_ID) missing.push('AI_TEAMS_FIREBASE_APP_ID');
  if (!AI_TEAMS_GOOGLE_CLIENT_ID) missing.push('AI_TEAMS_GOOGLE_CLIENT_ID');
  if (!AI_TEAMS_GOOGLE_CLIENT_SECRET) missing.push('AI_TEAMS_GOOGLE_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new Error(
      `Configurazione mancante. Imposta le variabili ambiente: ${missing.join(', ')}. ` +
        `Trovi questi valori dopo aver creato il progetto Firebase (Fase Terraform) e un OAuth client "Desktop" su Google Cloud Console.`,
    );
  }

  const mode = (AI_TEAMS_PERMISSION_MODE as BridgeConfig['defaultPermissionMode']) || 'plan';

  return {
    firebase: {
      apiKey: AI_TEAMS_FIREBASE_API_KEY!,
      authDomain: AI_TEAMS_FIREBASE_AUTH_DOMAIN!,
      projectId: AI_TEAMS_FIREBASE_PROJECT_ID!,
      appId: AI_TEAMS_FIREBASE_APP_ID!,
      storageBucket: AI_TEAMS_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: AI_TEAMS_FIREBASE_MESSAGING_SENDER_ID,
    },
    oauth: {
      clientId: AI_TEAMS_GOOGLE_CLIENT_ID!,
      clientSecret: AI_TEAMS_GOOGLE_CLIENT_SECRET!,
    },
    defaultPermissionMode: mode,
  };
}
