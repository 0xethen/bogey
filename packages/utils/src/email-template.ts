import { formatMessage, type Messages } from "./messages.ts";

export type TemplateValues = Readonly<Record<string, string>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""))];
}

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const HEADING_FONT =
  "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO_FONT = "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const STYLE = {
  p: "margin:0 0 16px;font-size:16px;line-height:1.6;color:#1c1917",
  h1: `margin:0 0 14px;font-family:${HEADING_FONT};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;color:#1c1917`,
  h2: `margin:0 0 12px;font-family:${HEADING_FONT};font-size:20px;line-height:1.3;font-weight:700;color:#1c1917`,
  h3: `margin:0 0 8px;font-family:${HEADING_FONT};font-size:16px;line-height:1.4;font-weight:700;color:#1c1917`,
  list: "margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:#1c1917",
  quote:
    "margin:0 0 16px;padding:4px 0 4px 14px;border-left:3px solid #e7e5e4;font-size:16px;line-height:1.6;color:#78716c",
  hr: "margin:24px 0;border:0;border-top:1px solid #e7e5e4",
  link: "color:{{accent}};text-decoration:underline;word-break:break-word",
  inlineCode: `padding:1px 6px;border-radius:6px;background:#f5f5f4;font-family:${MONO_FONT};font-size:0.92em`,
  code: `margin:0 0 20px;padding:18px 16px;border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;text-align:center;font-family:${MONO_FONT};font-size:30px;font-weight:600;letter-spacing:7px;color:#1c1917`,
  button:
    "display:inline-block;padding:13px 26px;border-radius:10px;background:{{accent}};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none",
} as const;

const URL_SOURCE = String.raw`(https?:\/\/[^\s)]+|\{\{\s*[a-zA-Z][a-zA-Z0-9]*\s*\}\})`;
const MD_LINK = new RegExp(String.raw`\[([^\]]+)\]\(${URL_SOURCE}\)`, "g");
const BUTTON = new RegExp(String.raw`^\*\*\[([^\]]+)\]\(${URL_SOURCE}\)\*\*$`);
const BARE_URL = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;

function inline(source: string): string {
  const parts: string[] = [];
  const stash = (html: string) => `\uE000${parts.push(html) - 1}\uE000`;
  const escaped = escapeHtml(source)
    .replace(/`([^`\n]+)`/g, (_, code: string) =>
      stash(`<code class="mono" style="${STYLE.inlineCode}">${code}</code>`),
    )
    .replace(MD_LINK, (_, label: string, href: string) =>
      stash(`<a class="link" href="${href}" style="${STYLE.link}">${label}</a>`),
    )
    .replace(BARE_URL, (_, before: string, href: string) =>
      stash(`${before}<a class="link" href="${href}" style="${STYLE.link}">${href}</a>`),
    )
    .replace(/\{\{\s*link\s*\}\}/g, () =>
      stash(`<a class="link" href="{{link}}" style="${STYLE.link}">{{link}}</a>`),
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
  return escaped.replace(/\uE000(\d+)\uE000/g, (_, index: string) => parts[Number(index)] ?? "");
}

function lines(block: string): string[] {
  return block.split("\n");
}

function blockHtml(block: string): string {
  const heading = /^(#{1,3})\s+(.+)$/.exec(block);
  if (heading) {
    const level = heading[1]?.length === 3 ? 3 : heading[1]?.length === 2 ? 2 : 1;
    const style = level === 1 ? STYLE.h1 : level === 2 ? STYLE.h2 : STYLE.h3;
    return `<h${level} class="heading" style="${style}">${inline(heading[2] ?? "")}</h${level}>`;
  }
  if (/^(-{3,}|\*{3,})$/.test(block)) return `<hr class="rule" style="${STYLE.hr}">`;
  if (lines(block).every((line) => /^[-*]\s+/.test(line))) {
    const items = lines(block).map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    return `<ul style="${STYLE.list}">${items.join("")}</ul>`;
  }
  if (lines(block).every((line) => /^\d+[.)]\s+/.test(line))) {
    const items = lines(block).map((line) => `<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
    return `<ol style="${STYLE.list}">${items.join("")}</ol>`;
  }
  if (lines(block).every((line) => line.startsWith(">"))) {
    const quoted = lines(block).map((line) => line.replace(/^>\s?/, ""));
    return `<blockquote class="quote" style="${STYLE.quote}">${inline(quoted.join("\n"))}</blockquote>`;
  }
  const button = BUTTON.exec(block);
  if (button) {
    return `<p style="margin:0"><a class="button" href="${escapeHtml(button[2] ?? "")}" style="${STYLE.button}">${escapeHtml(button[1] ?? "")}</a></p>`;
  }
  const code = /^`([^`\n]+)`$/.exec(block);
  if (code) return `<p class="codebox" style="${STYLE.code}">${escapeHtml(code[1] ?? "")}</p>`;
  return `<p style="${STYLE.p}">${inline(block)}</p>`;
}

export function markdownToEmailHtml(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(blockHtml)
    .join("\n");
}

export function markdownToEmailText(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const button = BUTTON.exec(block.trim());
      if (button) return `${button[1]}: ${button[2]}`;
      return block
        .trim()
        .replace(/^#{1,3}\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^(-{3,}|\*{3,})$/gm, "-----")
        .replace(MD_LINK, (_, label: string, href: string) => `${label} (${href})`)
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1$2")
        .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1$2");
    })
    .join("\n\n");
}

function fillHtml(html: string, values: TemplateValues): string {
  return html.replace(PLACEHOLDER, (_, name: string) => escapeHtml(values[name] ?? ""));
}

export interface EmailParts {
  layout: string;
  fallbackLayout: string;
  subject: string;
  body: string;
  values: TemplateValues;
  org: string;
  platform: string;
  reason: string;
  unsubscribeUrl?: string;
  footer?: EmailFooterWords;
  locale?: string;
}

export interface EmailFooterWords {
  because: string;
  sentBy: string;
  sentByFor: string;
  unsubscribeText: string;
  unsubscribeLink: string;
}

export const ENGLISH_FOOTER: EmailFooterWords = {
  because: "You're receiving this email because {reason}. If that wasn't you, you can ignore it.",
  sentBy: "Sent by {platform}.",
  sentByFor: "Sent by {platform} on behalf of {org}.",
  unsubscribeText: "Don't want these emails? Unsubscribe: {url}",
  unsubscribeLink: "Unsubscribe from these emails",
};

export function footerWords(messages: Messages): EmailFooterWords {
  const word = (name: keyof EmailFooterWords) =>
    messages[`emailFooter.${name}`] ?? ENGLISH_FOOTER[name];
  return {
    because: word("because"),
    sentBy: word("sentBy"),
    sentByFor: word("sentByFor"),
    unsubscribeText: word("unsubscribeText"),
    unsubscribeLink: word("unsubscribeLink"),
  };
}

export function localizedTemplateKey(key: string, locale: string | null | undefined): string {
  return locale && locale !== "en" ? `${key}@${locale}` : key;
}

export interface TemplateText {
  subject: string;
  body: string;
}

export function translatedEmail(
  messages: Messages,
  key: string,
): (TemplateText & { reason: string | undefined }) | undefined {
  const subject = messages[`emailTemplate.${key}.subject`];
  const body = messages[`emailTemplate.${key}.body`];
  if (subject === undefined || body === undefined) return undefined;
  return { subject, body, reason: messages[`emailTemplate.${key}.reason`] };
}

export function pickTemplate(
  saved: Readonly<Record<string, TemplateText | undefined>>,
  key: string,
  locale: string | null | undefined,
  translated: TemplateText | undefined,
  fallback: TemplateText,
): TemplateText {
  const own = locale ? saved[localizedTemplateKey(key, locale)] : undefined;
  return own ?? saved[key] ?? translated ?? fallback;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const DEFAULT_ACCENT = "#c2410c";

const FOOTER_TOKEN = /\{\{\s*footer\s*\}\}/;

export function renderEmail(parts: EmailParts): RenderedEmail {
  const { values, org, platform } = parts;
  const layout = /\{\{\s*content\s*\}\}/.test(parts.layout) ? parts.layout : parts.fallbackLayout;
  const accent = /^#[0-9a-f]{6}$/i.test(values.accent ?? "")
    ? (values.accent ?? "")
    : DEFAULT_ACCENT;
  const subject = renderTemplate(parts.subject, { org, platform, ...values })
    .replace(/\s+/g, " ")
    .trim();
  const all = { org, platform, ...values, accent, subject };

  const reason = renderTemplate(parts.reason, all).replace(/\s+/g, " ").trim();
  const words = parts.footer ?? ENGLISH_FOOTER;
  const locale = parts.locale ?? "en";
  const platformLine =
    org === platform
      ? formatMessage(words.sentBy, { platform }, locale)
      : formatMessage(words.sentByFor, { platform, org }, locale);
  const reasonLine = formatMessage(words.because, { reason }, locale);
  const unsubscribeLine = parts.unsubscribeUrl
    ? formatMessage(words.unsubscribeText, { url: parts.unsubscribeUrl }, locale)
    : "";
  const footerText = [reasonLine, platformLine, unsubscribeLine].filter(Boolean).join(" ");
  const footerHtml =
    `<p class="footer" style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#78716c">` +
    `${escapeHtml(reasonLine)}</p>` +
    `<p class="footer" style="margin:${parts.unsubscribeUrl ? "0 0 8px" : "0"};font-size:13px;line-height:1.55;color:#a8a29e">${escapeHtml(platformLine)}</p>` +
    (parts.unsubscribeUrl
      ? `<p class="footer" style="margin:0;font-size:13px;line-height:1.55;color:#a8a29e"><a href="${escapeHtml(parts.unsubscribeUrl)}" style="color:#a8a29e;text-decoration:underline">${escapeHtml(words.unsubscribeLink)}</a></p>`
      : "");

  const logo = values.logo;
  const initial = escapeHtml([...org.trim()][0]?.toUpperCase() ?? "B");
  const brand = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(org)}" height="32" style="display:block;height:32px;border:0">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="32" height="32" align="center" style="width:32px;height:32px;border-radius:9px;background:${accent};color:#ffffff;font-family:${HEADING_FONT};font-size:17px;font-weight:700;line-height:32px">${initial}</td>` +
      `<td class="brand" style="padding-left:10px;font-family:${HEADING_FONT};font-size:18px;font-weight:700;color:#1c1917">${escapeHtml(org)}</td>` +
      `</tr></table>`;

  const content = fillHtml(markdownToEmailHtml(parts.body), all);
  let html = layout
    .replace(/\{\{\s*content\s*\}\}/, () => "\uE001content\uE001")
    .replace(/\{\{\s*brand\s*\}\}/g, () => "\uE001brand\uE001")
    .replace(FOOTER_TOKEN, () => "\uE001footer\uE001");
  if (!html.includes("\uE001footer\uE001")) {
    html = html.includes("</body>")
      ? html.replace("</body>", () => "\uE001footer\uE001</body>")
      : `${html}\uE001footer\uE001`;
  }
  html = fillHtml(html, all)
    .replace("\uE001content\uE001", () => content)
    .replace(/\uE001brand\uE001/g, () => brand)
    .replace("\uE001footer\uE001", () => footerHtml);

  const text = renderTemplate(markdownToEmailText(parts.body), all);
  return { subject, html, text: `${text}\n\n--\n${footerText}\n` };
}
