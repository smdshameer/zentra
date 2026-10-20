/**
 * ZENTRA — Sync Cursor Utility
 * apps/api/src/modules/sync/utils/sync-cursor.ts
 *
 * Provides opaque cursor encoding and decoding for server-authoritative delta pagination.
 * Clients must treat cursors as completely opaque tokens without parsing them.
 */

export interface DecodedSyncCursor {
  timestamp: string; // ISO 8601 UTC timestamp
  tombstoneSeq: number; // BigSerial sequence number
}

const BASELINE_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const BASELINE_TOMBSTONE_SEQ = 0;

/**
 * Encodes a timestamp and tombstone sequence into an opaque, URL-safe base64 token.
 */
export function encodeSyncCursor(
  timestamp: Date | string,
  tombstoneSeq: number | bigint,
): string {
  const tsString = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
  const payload = {
    t: tsString,
    s: Number(tombstoneSeq),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decodes an opaque cursor token. Returns a safe baseline if the cursor is missing or malformed.
 */
export function decodeSyncCursor(cursor?: string | null): DecodedSyncCursor {
  if (!cursor || typeof cursor !== 'string' || cursor.trim().length === 0) {
    return {
      timestamp: BASELINE_TIMESTAMP,
      tombstoneSeq: BASELINE_TOMBSTONE_SEQ,
    };
  }

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    return {
      timestamp: typeof parsed.t === 'string' ? parsed.t : BASELINE_TIMESTAMP,
      tombstoneSeq: typeof parsed.s === 'number' && Number.isFinite(parsed.s) ? parsed.s : BASELINE_TOMBSTONE_SEQ,
    };
  } catch {
    return {
      timestamp: BASELINE_TIMESTAMP,
      tombstoneSeq: BASELINE_TOMBSTONE_SEQ,
    };
  }
}
