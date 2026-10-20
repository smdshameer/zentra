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
  changeSeq: number; // Commit-ordered ledger sequence number (Stage 6G)
  isLedgerCursor: boolean;
}

const BASELINE_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const BASELINE_TOMBSTONE_SEQ = 0;
const BASELINE_CHANGE_SEQ = 0;

/**
 * Encodes a timestamp, tombstone sequence, and change ledger sequence into an opaque, URL-safe base64 token.
 */
export function encodeSyncCursor(
  timestamp: Date | string,
  tombstoneSeq: number | bigint,
  changeSeq?: number | bigint,
): string {
  const tsString = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
  const payload: {
    t: string;
    s: number;
    c?: number;
    seq?: number;
    v?: number;
  } = {
    t: tsString,
    s: Number(tombstoneSeq),
  };

  if (changeSeq !== undefined) {
    const cVal = Number(changeSeq);
    payload.c = cVal;
    payload.seq = cVal;
    payload.v = 3;
  }

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
      changeSeq: BASELINE_CHANGE_SEQ,
      isLedgerCursor: true,
    };
  }

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    const hasLedgerField =
      parsed.c !== undefined || parsed.seq !== undefined || parsed.v === 3;
    const isLegacyCursor =
      parsed.lastSyncTimestamp !== undefined || (!hasLedgerField && parsed.t !== undefined);

    const parsedChangeSeq =
      typeof parsed.c === 'number' && Number.isFinite(parsed.c)
        ? parsed.c
        : typeof parsed.seq === 'number' && Number.isFinite(parsed.seq)
          ? parsed.seq
          : BASELINE_CHANGE_SEQ;

    return {
      timestamp: typeof parsed.t === 'string' ? parsed.t : (typeof parsed.lastSyncTimestamp === 'string' ? parsed.lastSyncTimestamp : BASELINE_TIMESTAMP),
      tombstoneSeq:
        typeof parsed.s === 'number' && Number.isFinite(parsed.s)
          ? parsed.s
          : (typeof parsed.tombstoneSeq === 'number' && Number.isFinite(parsed.tombstoneSeq) ? parsed.tombstoneSeq : BASELINE_TOMBSTONE_SEQ),
      changeSeq: parsedChangeSeq,
      isLedgerCursor: !isLegacyCursor || hasLedgerField,
    };
  } catch {
    return {
      timestamp: BASELINE_TIMESTAMP,
      tombstoneSeq: BASELINE_TOMBSTONE_SEQ,
      changeSeq: BASELINE_CHANGE_SEQ,
      isLedgerCursor: true,
    };
  }
}
