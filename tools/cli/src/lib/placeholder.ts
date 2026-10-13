export function isPlaceholder(value: string): boolean {
  return /your-|replace-with|example\.com/.test(value);
}
