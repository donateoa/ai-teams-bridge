import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { FirebaseConfig } from './config';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(config: FirebaseConfig): FirebaseApp {
  if (!app) {
    app = getApps()[0] ?? initializeApp(config);
  }
  return app;
}

export function getDb(config: FirebaseConfig): Firestore {
  if (!db) db = getFirestore(getFirebaseApp(config));
  return db;
}
