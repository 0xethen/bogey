export const LAYOUT_PLACEHOLDERS = [
  "content",
  "brand",
  "footer",
  "subject",
  "org",
  "platform",
  "accent",
] as const;

export function layoutProblem(layout: string): string | null {
  if (!/\{\{\s*content\s*\}\}/.test(layout)) return "Include {{content}} where the message goes.";
  if (/<script[\s>]/i.test(layout)) return "Mail clients drop scripts; take the <script> out.";
  return null;
}

export { DEFAULT_EMAIL_LAYOUT } from "./layout.gen.ts";
