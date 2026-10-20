/**
 * ZENTRA Field — Platform File Reader (Node.js / Headless Test Runtime)
 * apps/field/src/domain/repositories/file-reader.ts
 *
 * Reads physical binary bytes from local file URIs using Node.js filesystem APIs.
 * Resolved by Vitest during unit and integration test runs in Node.js.
 * Fails closed if the URI is missing, unreadable, or 0 bytes.
 */

import * as fs from 'node:fs';

export async function readLocalFileBytes(localUri: string): Promise<Uint8Array> {
  if (!localUri || !localUri.trim()) {
    throw new Error('Cannot read file: local URI is missing or empty');
  }

  const cleanUri = localUri.trim();

  let filePath = cleanUri;
  if (filePath.startsWith('file://')) {
    try {
      filePath = new URL(cleanUri).pathname;
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
    } catch {
      filePath = cleanUri.replace(/^file:\/\//, '');
    }
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Evidence file not found at local URI: ${cleanUri}`);
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err: any) {
    throw new Error(`Evidence file unreadable at local URI: ${cleanUri} (${err?.message || err})`);
  }

  const fileBytes = new Uint8Array(buffer);

  if (fileBytes.byteLength === 0) {
    throw new Error(`Evidence file at ${cleanUri} is empty (0 bytes)`);
  }

  return fileBytes;
}
