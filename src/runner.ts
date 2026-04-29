import {
  Firestore,
  addDoc,
  collection,
  deleteField,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BridgeConfig } from './config';
import { getSessionId, setSessionId, clearSessionId } from './sessions';
import { redactSecrets } from './redact';
import { getDeviceId } from './device';

function resolveWorkdir(workdir: string): string {
  const expanded = workdir.startsWith('~')
    ? resolve(homedir(), workdir.slice(workdir.startsWith('~/') ? 2 : 1))
    : workdir;
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    throw new Error(`Workdir non valido: "${workdir}" non esiste o non è una directory`);
  }
  return expanded;
}

interface CommandDoc {
  id: string;
  chatId: string;
  ownerUid: string;
  kind: 'prompt' | 'clear' | 'compact' | 'stop';
  status: 'pending' | 'running' | 'done' | 'error';
  prompt?: string;
  workdir?: string;
  targetCommandId?: string;
}

const activeRuns = new Map<string, AbortController>();

export async function handleCommand(
  db: Firestore,
  config: BridgeConfig,
  cmd: CommandDoc,
): Promise<void> {
  if (cmd.kind === 'stop') {
    await handleStop(db, cmd);
    return;
  }

  const claimed = await claimCommand(db, cmd.id);
  if (!claimed) return;

  try {
    switch (cmd.kind) {
      case 'prompt':
        await handlePrompt(db, config, cmd);
        break;
      case 'clear':
        await handleClear(db, cmd);
        break;
      case 'compact':
        await handleCompact(db, cmd);
        break;
    }
    await finalizeCommand(db, cmd.id, 'done');
  } catch (err: any) {
    console.error('[runner] errore esecuzione', cmd.id, err);
    await publishSystem(db, cmd, `Errore: ${err?.message ?? err}`, 'claude-error');
    await finalizeCommand(db, cmd.id, 'error', String(err?.message ?? err));
  }
}

async function claimCommand(db: Firestore, commandId: string): Promise<boolean> {
  const deviceId = getDeviceId();
  const ref = doc(db, 'commands', commandId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.status !== 'pending') return false;
    tx.update(ref, {
      status: 'running',
      startedAt: serverTimestamp(),
      runnerDeviceId: deviceId,
    });
    return true;
  });
}

async function finalizeCommand(
  db: Firestore,
  commandId: string,
  status: 'done' | 'error',
  error?: string,
): Promise<void> {
  const patch: Record<string, any> = {
    status,
    finishedAt: serverTimestamp(),
  };
  if (error) patch.error = error;
  await updateDoc(doc(db, 'commands', commandId), patch);
  activeRuns.delete(commandId);
}

function stripClaudePrefix(text: string): string {
  return text.replace(/^\/claude\b\s*/i, '').trim();
}

async function buildContextPrompt(db: Firestore, cmd: CommandDoc, prompt: string): Promise<string> {
  const chatSnap = await getDoc(doc(db, 'chats', cmd.chatId));
  const chat = chatSnap.data() as any;
  const title: string = chat?.title ?? cmd.chatId;
  const members: Record<string, string> = {};
  for (const [uid, m] of Object.entries(chat?.members ?? {})) {
    const member = m as any;
    members[uid] = member.displayName || member.email || uid;
  }

  const msgsSnap = await getDocs(
    query(collection(db, `chats/${cmd.chatId}/messages`), orderBy('ts', 'asc')),
  );

  const lines: string[] = [];
  for (const d of msgsSnap.docs) {
    const m = d.data() as any;
    if (m.kind === 'claude-system' || m.kind === 'claude-error') continue;
    const ts: Date = m.ts?.toDate?.() ?? new Date();
    const timeStr = ts.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    if (m.kind === 'claude-output') {
      lines.push(`[${timeStr}] Claude: ${m.text}`);
    } else {
      const name = members[m.senderUid] ?? m.senderUid;
      lines.push(`[${timeStr}] ${name}: ${m.text}`);
    }
  }

  if (lines.length === 0) return prompt;

  return `Conversazione nella chat "${title}":\n\n${lines.join('\n')}\n\n---\nNuovo messaggio: ${prompt}`;
}

async function handlePrompt(
  db: Firestore,
  config: BridgeConfig,
  cmd: CommandDoc,
): Promise<void> {
  if (!cmd.prompt || !cmd.workdir) {
    throw new Error('prompt o workdir mancante');
  }
  const cleanedPrompt = stripClaudePrefix(cmd.prompt);
  if (!cleanedPrompt) {
    throw new Error('prompt vuoto dopo aver rimosso il prefisso /claude');
  }
  const workdir = resolveWorkdir(cmd.workdir);
  console.log(`[runner] prompt="${cleanedPrompt.slice(0, 80)}" workdir="${workdir}"`);

  const abort = new AbortController();
  activeRuns.set(cmd.id, abort);

  let resumeId = getSessionId(cmd.chatId);
  let attempt = 0;
  while (true) {
    const result = await runPromptAttempt(db, cmd, workdir, config, abort, resumeId, cleanedPrompt);
    if (result.staleSession && !result.emittedOutput && resumeId && attempt === 0) {
      console.log(`[runner] sessione ${resumeId} non più valida, retry da zero`);
      clearSessionId(cmd.chatId);
      await updateDoc(doc(db, 'chats', cmd.chatId), { claudeSessionId: deleteField() });
      resumeId = undefined;
      attempt++;
      continue;
    }
    if (result.error) throw result.error;
    return;
  }
}

interface AttemptResult {
  emittedOutput: boolean;
  staleSession: boolean;
  error?: Error;
}

async function runPromptAttempt(
  db: Firestore,
  cmd: CommandDoc,
  workdir: string,
  config: BridgeConfig,
  abort: AbortController,
  resumeId: string | undefined,
  cleanedPrompt: string,
): Promise<AttemptResult> {
  const prompt = resumeId ? cleanedPrompt : await buildContextPrompt(db, cmd, cleanedPrompt);

  let stderrText = '';
  const options: Record<string, unknown> = {
    cwd: workdir,
    permissionMode: config.defaultPermissionMode,
    abortController: abort,
    executable: process.execPath,
    stderr: (line: string) => {
      stderrText += line + '\n';
      process.stderr.write(`[claude-code] ${line}\n`);
    },
  };
  if (resumeId) options.resume = resumeId;

  const buffer: string[] = [];
  let newSessionId: string | undefined;

  const FLUSH_INTERVAL_MS = 300;
  let messageRef: DocumentReference | null = null;
  let lastFlushedLength = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  let flushChain: Promise<void> = Promise.resolve();

  const ensureMessageDoc = async (): Promise<void> => {
    if (messageRef) return;
    const ref = doc(collection(db, `chats/${cmd.chatId}/messages`));
    await setDoc(ref, {
      senderUid: cmd.ownerUid,
      text: '',
      ts: serverTimestamp(),
      kind: 'claude-output',
      commandId: cmd.id,
      streaming: true,
    });
    messageRef = ref;
  };

  const flushNow = async (): Promise<void> => {
    if (!messageRef) return;
    const currentText = buffer.join('');
    if (currentText.length === lastFlushedLength) return;
    lastFlushedLength = currentText.length;
    await updateDoc(messageRef, { text: redactSecrets(currentText) });
  };

  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushChain = flushChain
        .catch(() => undefined)
        .then(() => flushNow())
        .catch((err) => {
          console.error('[runner] flush stream error', err);
        });
    }, FLUSH_INTERVAL_MS);
  };

  let streamError: Error | undefined;
  try {
    for await (const msg of claudeQuery({ prompt, options }) as any) {
      if (abort.signal.aborted) break;

      if (msg.type === 'assistant' && msg.message?.content) {
        let appended = false;
        for (const c of msg.message.content) {
          if (c.type === 'text' && typeof c.text === 'string') {
            process.stdout.write(c.text);
            buffer.push(c.text);
            appended = true;
          }
        }
        if (appended) {
          await ensureMessageDoc();
          scheduleFlush();
        }
      }
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        newSessionId = msg.session_id;
      }
      if (msg.type === 'result') {
        if (msg.session_id) newSessionId = msg.session_id;
      }
    }
  } catch (err: any) {
    streamError = err instanceof Error ? err : new Error(String(err));
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushChain.catch(() => undefined);
  }

  const emittedOutput = buffer.length > 0;
  const staleSession = /No conversation found with session ID/i.test(stderrText);

  if (streamError && !emittedOutput && staleSession) {
    return { emittedOutput, staleSession, error: streamError };
  }

  const fullText = buffer.join('').trim();
  if (fullText) process.stdout.write('\n');

  if (messageRef) {
    const redacted = fullText ? redactSecrets(fullText) : '';
    await updateDoc(messageRef, { text: redacted, streaming: false });
    await finalizeChatAfterStream(db, cmd, redacted);
  } else if (abort.signal.aborted) {
    await publishSystem(db, cmd, 'Comando interrotto', 'claude-system');
  }

  if (newSessionId) {
    setSessionId(cmd.chatId, newSessionId);
    await updateDoc(doc(db, 'chats', cmd.chatId), { claudeSessionId: newSessionId });
  }

  return { emittedOutput, staleSession, error: streamError };
}

async function finalizeChatAfterStream(
  db: Firestore,
  cmd: CommandDoc,
  text: string,
): Promise<void> {
  const chatRef = doc(db, 'chats', cmd.chatId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists()) return;
    const chat = snap.data();
    const unreadPatch: Record<string, any> = {};
    for (const uid of chat.memberUids as string[]) {
      if (uid !== cmd.ownerUid) unreadPatch[`unreadByUser.${uid}`] = increment(1);
    }
    tx.update(chatRef, {
      lastMessage: {
        text: text.slice(0, 200),
        senderUid: cmd.ownerUid,
        ts: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
      ...unreadPatch,
    });
  });
}

async function handleClear(db: Firestore, cmd: CommandDoc): Promise<void> {
  clearSessionId(cmd.chatId);
  await updateDoc(doc(db, 'chats', cmd.chatId), { claudeSessionId: deleteField() });
  await publishSystem(db, cmd, 'Sessione Claude azzerata', 'claude-system');
}

async function handleCompact(db: Firestore, cmd: CommandDoc): Promise<void> {
  const resumeId = getSessionId(cmd.chatId);
  if (!resumeId) {
    await publishSystem(db, cmd, 'Nessuna sessione Claude attiva da compattare', 'claude-system');
    return;
  }

  const abort = new AbortController();
  activeRuns.set(cmd.id, abort);

  const options: Record<string, unknown> = {
    cwd: process.cwd(),
    resume: resumeId,
    abortController: abort,
    executable: process.execPath,
    stderr: (line: string) => process.stderr.write(`[claude-code] ${line}\n`),
  };

  let newSessionId: string | undefined;
  for await (const msg of claudeQuery({
    prompt:
      'Please compact the conversation so far: summarize what has been discussed and decided, keep the essential context, and discard redundant details.',
    options,
  }) as any) {
    if (abort.signal.aborted) break;
    if (msg.type === 'result' && msg.session_id) newSessionId = msg.session_id;
    if (msg.type === 'system' && msg.session_id) newSessionId = msg.session_id;
  }

  if (newSessionId) setSessionId(cmd.chatId, newSessionId);
  await publishSystem(db, cmd, 'Sessione Claude compattata', 'claude-system');
}

async function handleStop(db: Firestore, cmd: CommandDoc): Promise<void> {
  const target = cmd.targetCommandId;
  if (!target) return;
  const ctrl = activeRuns.get(target);
  if (ctrl) {
    ctrl.abort();
    activeRuns.delete(target);
  }
  await updateDoc(doc(db, 'commands', cmd.id), {
    status: 'done',
    finishedAt: serverTimestamp(),
  });
}

async function publishSystem(
  db: Firestore,
  cmd: CommandDoc,
  text: string,
  kind: 'claude-system' | 'claude-error',
): Promise<void> {
  await addDoc(collection(db, `chats/${cmd.chatId}/messages`), {
    senderUid: cmd.ownerUid,
    text,
    ts: serverTimestamp(),
    kind,
    commandId: cmd.id,
  });
}
