import {
  Firestore,
  addDoc,
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk';
import { BridgeConfig } from './config';
import { getSessionId, setSessionId, clearSessionId } from './sessions';
import { redactSecrets } from './redact';
import { getDeviceId } from './device';

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

async function handlePrompt(
  db: Firestore,
  config: BridgeConfig,
  cmd: CommandDoc,
): Promise<void> {
  if (!cmd.prompt || !cmd.workdir) {
    throw new Error('prompt o workdir mancante');
  }
  console.log(`[runner] prompt="${cmd.prompt.slice(0, 80)}" workdir="${cmd.workdir}"`);

  const resumeId = getSessionId(cmd.chatId);
  const abort = new AbortController();
  activeRuns.set(cmd.id, abort);

  const options: Record<string, unknown> = {
    cwd: cmd.workdir,
    permissionMode: config.defaultPermissionMode,
    abortController: abort,
  };
  if (resumeId) options.resume = resumeId;

  const buffer: string[] = [];
  let newSessionId: string | undefined;

  for await (const msg of claudeQuery({ prompt: cmd.prompt, options }) as any) {
    if (abort.signal.aborted) break;

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const c of msg.message.content) {
        if (c.type === 'text' && typeof c.text === 'string') {
          buffer.push(c.text);
        }
      }
    }
    if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
      newSessionId = msg.session_id;
    }
    if (msg.type === 'result') {
      if (msg.session_id) newSessionId = msg.session_id;
    }
  }

  const fullText = buffer.join('').trim();
  if (fullText) {
    await publishMessage(db, cmd, redactSecrets(fullText), 'claude-output');
  } else if (abort.signal.aborted) {
    await publishSystem(db, cmd, 'Comando interrotto', 'claude-system');
  }

  if (newSessionId) setSessionId(cmd.chatId, newSessionId);
}

async function handleClear(db: Firestore, cmd: CommandDoc): Promise<void> {
  clearSessionId(cmd.chatId);
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

async function publishMessage(
  db: Firestore,
  cmd: CommandDoc,
  text: string,
  kind: 'claude-output' | 'claude-error',
): Promise<void> {
  const chatRef = doc(db, 'chats', cmd.chatId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists()) return;
    const chat = snap.data();

    const msgRef = doc(collection(db, `chats/${cmd.chatId}/messages`));
    tx.set(msgRef, {
      senderUid: cmd.ownerUid,
      text,
      ts: serverTimestamp(),
      kind,
      commandId: cmd.id,
    });

    const unreadPatch: Record<string, any> = {};
    for (const uid of chat.memberUids as string[]) {
      if (uid !== cmd.ownerUid) unreadPatch[`unreadByUser.${uid}`] = increment(1);
    }
    tx.update(chatRef, {
      lastMessage: { text: text.slice(0, 200), senderUid: cmd.ownerUid, ts: serverTimestamp() },
      updatedAt: serverTimestamp(),
      ...unreadPatch,
    });
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
