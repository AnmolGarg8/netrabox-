/**
 * Canonical JSON Serializer for NetraBox Cryptographic Hashing and Signature Verification
 *
 * CANONICAL JSON SPECIFICATION RULES:
 * 1. Undefined properties are omitted: In plain objects, keys whose values are undefined
 *    (or functions/symbols) are treated as omitted entirely (matching standard JSON.stringify).
 *    Inside arrays, undefined values are represented as `null`.
 * 2. Arrays keep exact order: Array element ordering is strictly preserved.
 * 3. Object keys sorted recursively: All dictionary/object keys are sorted lexicographically
 *    (by UTF-16 code unit order) at every nesting depth.
 * 4. Unicode is preserved without normalization: No Unicode normalization (e.g. NFC or NFD)
 *    is applied to strings. Characters, diacritics, and emoji (e.g. 🛡️, नेत्र, 円) preserve
 *    their exact raw code points and bytes.
 * 5. CRLF and LF are distinct data: \r\n (CRLF) and \n (LF) line breaks represent different
 *    data and hash to distinct SHA-256 digests.
 * 6. Date objects are serialized deterministically to ISO 8601 strings via toISOString().
 */
export function canonicalJson(obj: unknown): string {
  if (obj === undefined) {
    return "undefined";
  }

  if (obj === null || typeof obj === "number" || typeof obj === "boolean") {
    return JSON.stringify(obj);
  }

  if (typeof obj === "string") {
    return JSON.stringify(obj);
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }

  if (Array.isArray(obj)) {
    const items = obj.map((item) => (item === undefined ? "null" : canonicalJson(item)));
    return `[${items.join(",")}]`;
  }

  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    // Rule 1: Omit undefined properties, functions, and symbols from object keys
    const sortedKeys = Object.keys(record)
      .filter((key) => {
        const val = record[key];
        return val !== undefined && typeof val !== "function" && typeof val !== "symbol";
      })
      .sort();

    const pairs = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    );
    return `{${pairs.join(",")}}`;
  }

  return JSON.stringify(obj);
}
