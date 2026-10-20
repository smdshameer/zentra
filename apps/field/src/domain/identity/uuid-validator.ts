/**
 * ZENTRA Field — UUID Validation Utility
 * apps/field/src/domain/identity/uuid-validator.ts
 *
 * Enforces strict RFC 4122 / RFC 9562 UUID syntax validation for authoritative
 * server-side entity identifiers, distinguishing format validation from existence validation.
 */

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether an identifier is a well-formed canonical UUID string (v1-v7).
 * Rejects undefined, null, empty strings, 16-character local WatermelonDB IDs,
 * and malformed UUIDs.
 */
export function isValidUuid(id?: string | null): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return UUID_REGEX.test(id.trim());
}
