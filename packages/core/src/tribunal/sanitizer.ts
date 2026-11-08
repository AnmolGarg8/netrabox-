export interface WrapUntrustedOptions {
  maxLength?: number;
}

/**
 * Strips control characters, zero-width invisibles, and directional override characters.
 * Preserves standard whitespace (\t, \n, \r, and spaces).
 */
export function removeControlCharacters(text: string): string {
  return (
    text
      // ASCII control chars 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Unicode directional formatting, zero-width characters, BOM
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
  );
}

/**
 * Neutralizes any occurrence of our delimiter tags, closing tags, and XML-like tags
 * so untrusted text cannot close the block early or inject fake system directives.
 */
export function neutralizeDelimiters(text: string, tag: string): string {
  const cleanTag = tag.replace(/[^a-zA-Z0-9_-]/g, "_");

  let sanitized = text;

  // 1. Explicitly defang any closing or opening tag matching the target tag
  const targetClosingRegex = new RegExp(`</\\s*${cleanTag}\\s*>`, "gi");
  const targetOpeningRegex = new RegExp(`<\\s*${cleanTag}\\s*>`, "gi");
  sanitized = sanitized.replace(targetClosingRegex, `[NEUTRALIZED_CLOSING_TAG]`);
  sanitized = sanitized.replace(targetOpeningRegex, `[NEUTRALIZED_OPENING_TAG]`);

  // 2. Defang all other untrusted tags and closing tags
  sanitized = sanitized.replace(
    /<\/\s*untrusted_[a-zA-Z0-9_-]*\s*>/gi,
    "[NEUTRALIZED_UNTRUSTED_TAG]",
  );
  sanitized = sanitized.replace(
    /<\s*untrusted_[a-zA-Z0-9_-]*\s*>/gi,
    "[NEUTRALIZED_UNTRUSTED_TAG]",
  );

  // 3. Defang fake SYSTEM_OVERRIDE, SYSTEM_ALERT, and system directives
  sanitized = sanitized.replace(
    /<\/?\s*system[a-zA-Z0-9_-]*\s*>/gi,
    "[NEUTRALIZED_SYSTEM_DIRECTIVE]",
  );

  // 4. Escape any remaining closing tag sequences '</' and tag openings '<'
  sanitized = sanitized.replace(/<\//g, "&lt;/");
  sanitized = sanitized.replace(/<(?=[a-zA-Z_!/?])/g, "&lt;");

  return sanitized;
}

/**
 * Wraps untrusted text into explicitly delimited safe blocks:
 * 1. Converts input to string (JSON stringifies objects).
 * 2. Truncates to maxLength (default: 2000 chars, e.g. for dispute reasons).
 * 3. Removes control characters.
 * 4. Neutralizes delimiter tags and closing tags so text cannot break out early.
 * 5. Wraps in <tag>...</tag> style delimiters.
 */
export function wrapUntrusted(tag: string, text: unknown, options?: WrapUntrustedOptions): string {
  const cleanTag = tag.replace(/[^a-zA-Z0-9_-]/g, "_");
  const maxLength = options?.maxLength ?? 2000;

  let raw = "";
  if (text === null || text === undefined) {
    raw = "";
  } else if (typeof text === "string") {
    raw = text;
  } else if (typeof text === "object") {
    try {
      raw = JSON.stringify(text);
    } catch {
      raw = String(text);
    }
  } else {
    raw = String(text);
  }

  // 1. Remove control characters
  let sanitized = removeControlCharacters(raw);

  // 2. Truncate to maximum length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  // 3. Neutralize delimiter tags and closing tags
  sanitized = neutralizeDelimiters(sanitized, cleanTag);

  // 4. Wrap in delimiter tags
  return `<${cleanTag}>\n${sanitized}\n</${cleanTag}>`;
}
