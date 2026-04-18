import {
  Firestore,
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { BridgeConfig } from './config';
import { handleCommand } from './runner';

export function startListener(db: Firestore, config: BridgeConfig, ownerUid: string): () => void {
  const inFlight = new Set<string>();

  const q = query(
    collection(db, 'commands'),
    where('ownerUid', '==', ownerUid),
    where('status', '==', 'pending'),
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        const id = change.doc.id;
        if (inFlight.has(id)) continue;
        inFlight.add(id);

        const cmd = { id, ...change.doc.data() } as any;
        handleCommand(db, config, cmd)
          .catch((err) => console.error('[listener] unhandled', err))
          .finally(() => inFlight.delete(id));
      }
    },
    (err: any) => {
      const code = err?.code ?? 'unknown';
      console.error(`[listener] stream interrotto (code=${code}):`, err?.message ?? err);
      if (code === 'permission-denied') {
        console.error('  → refresh token o uid non valido. Rifai login: ai-teams-bridge login');
      } else {
        console.error('  → prova a riavviare: ai-teams-bridge start');
      }
    },
  );

  return unsub;
}
