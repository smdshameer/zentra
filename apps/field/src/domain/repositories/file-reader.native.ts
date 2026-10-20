/**
 * ZENTRA Field — Platform File Reader (React Native / Mobile Runtime)
 * apps/field/src/domain/repositories/file-reader.native.ts
 *
 * Reads physical binary bytes from local file:// and content:// URIs using
 * React Native's native fetch networking layer. Contains ZERO Node.js standard library imports.
 * Fails closed if the URI is invalid, unreadable, or 0 bytes.
 */

export async function readLocalFileBytes(localUri: string): Promise<Uint8Array> {
  if (!localUri || !localUri.trim()) {
    throw new Error('Cannot read file: local URI is missing or empty');
  }

  const cleanUri = localUri.trim();

  // Validate supported mobile URI schemes
  if (
    !cleanUri.startsWith('file://') &&
    !cleanUri.startsWith('content://') &&
    !cleanUri.startsWith('/')
  ) {
    throw new Error(`Unsupported URI scheme for mobile file reading: ${cleanUri}`);
  }

  let fileBytes: Uint8Array;
  try {
    const response = await fetch(cleanUri);
    if (!response.ok && response.status !== 0 && response.status !== 200) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    fileBytes = new Uint8Array(buffer);
  } catch (err: any) {
    throw new Error(`Evidence file unreadable at local URI: ${cleanUri} (${err?.message || err})`);
  }

  if (fileBytes.byteLength === 0) {
    throw new Error(`Evidence file at ${cleanUri} is empty (0 bytes)`);
  }

  return fileBytes;
}
