import crypto from 'node:crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function key(): Buffer {
  const raw = Buffer.from(config.secretsKey(), 'base64');
  if (raw.length !== 32) {
    throw new Error('SECRETS_KEY must be 32 bytes, base64-encoded');
  }
  return raw;
}

/** Encrypts UTF-8 text into a compact `iv.ciphertext.tag` envelope (base64url). */
export function sealSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, ciphertext, tag].map((part) => part.toString('base64url')).join('.');
}

export function openSecret(envelope: string): string {
  const [iv, ciphertext, tag] = envelope.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !ciphertext || !tag) {
    throw new Error('Malformed secret envelope');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
