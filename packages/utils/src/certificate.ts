export const CERTIFICATE_KINDS = ["participation", "award", "judge", "volunteer"] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export function isCertificateKind(value: string): value is CertificateKind {
  return CERTIFICATE_KINDS.some((kind) => kind === value);
}

export const CERTIFICATE_LABELS: Record<CertificateKind, string> = {
  participation: "Participation",
  award: "Award",
  judge: "Judge",
  volunteer: "Volunteer",
};

export const CERTIFICATE_VARIABLES: Record<string, string> = {
  name: "The person's name",
  event: "The event's name",
  org: "The organization's name",
  award: "The award's name (award certificates)",
  date: "When the event happened",
  code: "The certificate's verification code",
  link: "Where anyone can check it",
};

export const DEFAULT_CERTIFICATE_BODY: Record<CertificateKind, string> = {
  participation:
    "# Certificate of participation\n\nThis certifies that\n\n## {{name}}\n\ntook part in **{{event}}**, {{date}}.\n\n{{org}}",
  award:
    "# Certificate of achievement\n\nAwarded to\n\n## {{name}}\n\nfor **{{award}}** at **{{event}}**, {{date}}.\n\n{{org}}",
  judge:
    "# Certificate of appreciation\n\nThank you to\n\n## {{name}}\n\nfor judging at **{{event}}**, {{date}}.\n\n{{org}}",
  volunteer:
    "# Certificate of appreciation\n\nThank you to\n\n## {{name}}\n\nfor volunteering at **{{event}}**, {{date}}.\n\n{{org}}",
};

export function fillCertificate(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

export function eventDates(
  startsAt: string | null,
  endsAt: string | null,
  locale = "en-US",
): string {
  if (!startsAt) return "";
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
  const year = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" });
  const full = (date: Date) => `${month.format(date)} ${day.format(date)}, ${year.format(date)}`;
  if (!end || end.toISOString().slice(0, 10) === start.toISOString().slice(0, 10))
    return full(start);
  if (month.format(start) === month.format(end) && year.format(start) === year.format(end)) {
    return `${month.format(start)} ${day.format(start)}–${day.format(end)}, ${year.format(start)}`;
  }
  return `${full(start)} – ${full(end)}`;
}

export function verificationPath(code: string): string {
  return `/certificates/${code}`;
}

// A design is a page (A4, in millimetres) with a background and layers drawn in order.
export const CERTIFICATE_PAGES = {
  landscape: { width: 297, height: 210 },
  portrait: { width: 210, height: 297 },
} as const;
export type CertificateOrientation = keyof typeof CERTIFICATE_PAGES;

export const CERTIFICATE_FONTS = ["sans", "serif", "mono"] as const;
export type CertificateFont = (typeof CERTIFICATE_FONTS)[number];
export const CERTIFICATE_ALIGNS = ["left", "center", "right"] as const;
export type CertificateAlign = (typeof CERTIFICATE_ALIGNS)[number];
export const CERTIFICATE_MAX_LAYERS = 40;
export const CERTIFICATE_MAX_TEXT = 1000;

/** `path` is set for files stored in event-assets; `url` is always what's drawn. */
export interface CertificateImage {
  url: string;
  path?: string;
}

interface LayerBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CertificateTextLayer extends LayerBox {
  type: "text";
  /** Placeholders like {{name}}; **bold** and *italic* inline. */
  text: string;
  /** Points. */
  size: number;
  font: CertificateFont;
  bold: boolean;
  italic: boolean;
  align: CertificateAlign;
  color: string;
}

export interface CertificateImageLayer extends LayerBox {
  type: "image";
  image: CertificateImage;
  fit: "contain" | "cover";
}

export interface CertificateQrLayer extends LayerBox {
  type: "qr";
}

export type CertificateLayer = CertificateTextLayer | CertificateImageLayer | CertificateQrLayer;

export interface CertificateLayout {
  background: { color: string; image: CertificateImage | null; frame: boolean };
  layers: CertificateLayer[];
}

const COLOR = /^#[0-9a-f]{6}$/i;
const PT_TO_MM = 25.4 / 72;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, round(value)))
    : fallback;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number],
): T[number] {
  return options.find((option) => option === value) ?? fallback;
}

function parseImage(value: unknown): CertificateImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== "string" || !/^https?:\/\//.test(raw.url) || raw.url.length > 500) {
    return null;
  }
  return typeof raw.path === "string" && raw.path
    ? { url: raw.url, path: raw.path }
    : { url: raw.url };
}

function parseLayer(value: unknown, index: number): CertificateLayer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const box = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `layer-${index}`,
    x: num(raw.x, 0, -300, 600),
    y: num(raw.y, 0, -300, 600),
    w: num(raw.w, 40, 1, 600),
    h: num(raw.h, 10, 1, 600),
  };
  if (raw.type === "text") {
    return {
      ...box,
      type: "text",
      text: typeof raw.text === "string" ? raw.text.slice(0, CERTIFICATE_MAX_TEXT) : "",
      size: num(raw.size, 14, 4, 200),
      font: oneOf(raw.font, CERTIFICATE_FONTS, "sans"),
      bold: raw.bold === true,
      italic: raw.italic === true,
      align: oneOf(raw.align, CERTIFICATE_ALIGNS, "center"),
      color: typeof raw.color === "string" && COLOR.test(raw.color) ? raw.color : "#000000",
    };
  }
  if (raw.type === "image") {
    const image = parseImage(raw.image);
    if (!image) return null;
    return { ...box, type: "image", image, fit: raw.fit === "cover" ? "cover" : "contain" };
  }
  if (raw.type === "qr") return { ...box, type: "qr" };
  return null;
}

/** Reads a stored design, dropping what it can't draw. */
export function parseCertificateLayout(value: unknown): CertificateLayout {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const background = (
    raw.background && typeof raw.background === "object" ? raw.background : {}
  ) as Record<string, unknown>;
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  return {
    background: {
      color:
        typeof background.color === "string" && COLOR.test(background.color)
          ? background.color
          : "#ffffff",
      image: parseImage(background.image),
      frame: background.frame === true,
    },
    layers: layers
      .slice(0, CERTIFICATE_MAX_LAYERS)
      .flatMap((layer, index) => parseLayer(layer, index) ?? []),
  };
}

/** Lays wording out as stacked, centered text boxes (headings bigger), with the QR code below.
 * The migration to designs (20261024090000) does the same in SQL. */
export function certificateLayoutFromMarkdown(
  body: string,
  orientation: CertificateOrientation,
  background: string | null = null,
): CertificateLayout {
  const page = CERTIFICATE_PAGES[orientation];
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((block) => {
      const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(block);
      const level = heading ? heading[1]!.length : 0;
      const text = heading ? heading[2]! : block;
      const size = level === 1 ? 32 : level === 2 ? 24 : level > 2 ? 18 : 14;
      const lines = text.split("\n").length;
      return { text, size, bold: level > 0, h: round(size * PT_TO_MM * 1.25 * lines + 2) };
    });
  const gap = 4;
  const qr = 22;
  const qrY = page.height - 14 - qr;
  const top = 15;
  const room = qrY - 6 - top;
  const total = blocks.reduce((sum, block) => sum + block.h, 0) + gap * (blocks.length - 1);
  let y = round(Math.max(top, top + (room - total) / 2));
  const layers: CertificateLayer[] = blocks.map((block, index) => {
    const layer: CertificateTextLayer = {
      id: `text-${index + 1}`,
      type: "text",
      x: 20,
      y,
      w: page.width - 40,
      h: block.h,
      text: block.text,
      size: block.size,
      font: "sans",
      bold: block.bold,
      italic: false,
      align: "center",
      color: "#000000",
    };
    y = round(y + block.h + gap);
    return layer;
  });
  layers.push(
    { id: "qr", type: "qr", x: round((page.width - qr) / 2), y: qrY, w: qr, h: qr },
    {
      id: "link",
      type: "text",
      x: 20,
      y: page.height - 13,
      w: page.width - 40,
      h: 5,
      text: "{{link}}",
      size: 7,
      font: "sans",
      bold: false,
      italic: false,
      align: "center",
      color: "#555555",
    },
  );
  return {
    background: { color: "#ffffff", image: background ? { url: background } : null, frame: true },
    layers,
  };
}

export function defaultCertificateLayout(
  kind: CertificateKind,
  orientation: CertificateOrientation = "landscape",
): CertificateLayout {
  return certificateLayoutFromMarkdown(DEFAULT_CERTIFICATE_BODY[kind], orientation);
}

/** Moves and resizes layers in proportion when the page turns; the QR code stays square. */
export function turnCertificatePage(
  layout: CertificateLayout,
  from: CertificateOrientation,
  to: CertificateOrientation,
): CertificateLayout {
  if (from === to) return layout;
  const a = CERTIFICATE_PAGES[from];
  const b = CERTIFICATE_PAGES[to];
  const sx = b.width / a.width;
  const sy = b.height / a.height;
  return {
    ...layout,
    layers: layout.layers.map((layer) => {
      if (layer.type === "qr") {
        return {
          ...layer,
          x: round((layer.x + layer.w / 2) * sx - layer.w / 2),
          y: round((layer.y + layer.h / 2) * sy - layer.h / 2),
        };
      }
      return {
        ...layer,
        x: round(layer.x * sx),
        y: round(layer.y * sy),
        w: round(layer.w * sx),
        h: round(layer.h * sy),
      };
    }),
  };
}

/** The stored files a design points to. */
export function certificateLayoutPaths(layout: CertificateLayout): string[] {
  const paths = [
    layout.background.image?.path,
    ...layout.layers.map((layer) => (layer.type === "image" ? layer.image.path : undefined)),
  ];
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

/** Where a design's uploads go in event-assets. */
export function certificateFolder(scope: {
  orgId: string;
  eventId: string | null;
  kind: CertificateKind;
}): string {
  return `${scope.eventId ?? `org/${scope.orgId}`}/certificates/${scope.kind}`;
}

export function pointsToMm(points: number): number {
  return points * PT_TO_MM;
}

export interface CertificateRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Splits **bold** and *italic* runs out of a text box's text. */
export function certificateRuns(text: string): CertificateRun[] {
  const runs: CertificateRun[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*/g)) {
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index), bold: false, italic: false });
    }
    if (match[1] !== undefined) runs.push({ text: match[1], bold: true, italic: false });
    else runs.push({ text: match[2]!, bold: false, italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false, italic: false });
  return runs;
}
