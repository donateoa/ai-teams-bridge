import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { CONFIG_DIR, DEVICE_FILE } from './config';

export function getDeviceId(): string {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(DEVICE_FILE)) {
    try {
      const { id } = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      if (typeof id === 'string' && id.length > 0) return id;
    } catch {
      /* cade al rigenera */
    }
  }
  const id = `${os.hostname()}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(DEVICE_FILE, JSON.stringify({ id }, null, 2), { mode: 0o600 });
  return id;
}
