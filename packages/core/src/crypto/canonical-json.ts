export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const keyValues = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return `{${keyValues.join(",")}}`;
}
