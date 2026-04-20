import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { loadConfig } from '../config';
import { getDb, getFirebaseApp } from '../firebase';
import { loadRefreshToken, refreshGoogleIdToken, signInFirebaseWithGoogle } from '../auth';

export async function sendCommand(chatId: string, text: string): Promise<void> {
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
  const chatRef = doc(db, 'chats', chatId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists()) {
      throw new Error(`Chat "${chatId}" non trovata`);
    }
    const chat = snap.data();

    const msgRef = doc(collection(db, `chats/${chatId}/messages`));
    tx.set(msgRef, {
      senderUid: user.uid,
      text,
      ts: serverTimestamp(),
      kind: 'user',
    });

    const unreadPatch: Record<string, any> = {};
    for (const uid of chat.memberUids as string[]) {
      if (uid !== user.uid) unreadPatch[`unreadByUser.${uid}`] = increment(1);
    }
    tx.update(chatRef, {
      lastMessage: { text: text.slice(0, 200), senderUid: user.uid, ts: serverTimestamp() },
      updatedAt: serverTimestamp(),
      ...unreadPatch,
    });
  });

  console.log('Messaggio inviato.');
}
