import * as http from 'http';
import * as crypto from 'crypto';
import open from 'open';
import keytar from 'keytar';
import {
  GoogleAuthProvider,
  signInWithCredential,
  onAuthStateChanged,
  User,
  initializeAuth,
  inMemoryPersistence,
} from 'firebase/auth';
import { FirebaseApp } from 'firebase/app';
import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH, GoogleOAuthConfig } from './config';

const SCOPES = ['openid', 'email', 'profile'];

export interface GoogleTokens {
  id_token: string;
  refresh_token?: string;
  access_token: string;
  expires_in: number;
}

export async function runLoopbackOAuth(oauth: GoogleOAuthConfig): Promise<GoogleTokens> {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return new Promise<GoogleTokens>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const receivedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        const err = url.searchParams.get('error');

        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h1>Login fallito</h1><p>${err}</p>`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code || receivedState !== state) {
          res.writeHead(400).end('invalid_request');
          server.close();
          reject(new Error('invalid_state_or_missing_code'));
          return;
        }

        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const tokens = await exchangeCode(oauth, code, codeVerifier, `http://localhost:${port}/callback`);

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          `<html><body style="font-family:system-ui;padding:48px;text-align:center;">
            <h1>Login completato</h1>
            <p>Puoi chiudere questa scheda e tornare al terminale.</p>
          </body></html>`,
        );
        server.close();
        resolve(tokens);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const redirectUri = `http://localhost:${port}/callback`;

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', oauth.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      console.log('\nApro il browser per il login Google...\n');
      console.log(`Se non si apre, visita manualmente:\n${authUrl.toString()}\n`);
      await open(authUrl.toString());
    });
  });
}

async function exchangeCode(
  oauth: GoogleOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as GoogleTokens;
}

export async function refreshGoogleIdToken(
  oauth: GoogleOAuthConfig,
  refreshToken: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Refresh token failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as GoogleTokens;
}

export async function saveRefreshToken(refreshToken: string): Promise<void> {
  await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH, refreshToken);
}

export async function loadRefreshToken(): Promise<string | null> {
  return keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH);
}

export async function clearRefreshToken(): Promise<void> {
  await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_REFRESH);
}

export async function signInFirebaseWithGoogle(
  firebaseApp: FirebaseApp,
  idToken: string,
): Promise<User> {
  const auth = initializeAuth(firebaseApp, { persistence: inMemoryPersistence });
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  return new Promise<User>((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        unsub();
        resolve(u);
      }
    });
    if (result.user) resolve(result.user);
  });
}
