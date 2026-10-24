// Reads a slide deck (.pptx or .pdf) in the browser into pictures a certificate can use as its
// background. Nothing is sent anywhere until a slide is picked; see docs/adr/0034-certificate-backgrounds.md.
import { DECK_LIMITS, type DeckProblem, type DeckResponse } from "./slide-limits.ts";

export const DECK_ACCEPT =
  ".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Long side of a picked slide's picture: about 200 dpi on A4. */
const RASTER_SIDE = 2400;
const PREVIEW_SIDE = 480;
/** Leaves room under the event-assets bucket's 5 MB limit. */
const MAX_PICTURE_BYTES = 4.5 * 1024 * 1024;

export class DeckError extends Error {
  constructor(readonly reason: DeckProblem) {
    super(reason);
  }
}

export interface DeckSlide {
  number: number;
  width: number;
  height: number;
  /** Shows the slide in an `<img>`; valid until the deck is disposed. */
  preview: string;
  /** The slide as a PNG (or JPEG when a PNG would be too big) to upload. */
  render: () => Promise<File>;
}

export interface Deck {
  name: string;
  slides: DeckSlide[];
  dispose: () => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new DeckError("unreadable"));
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new DeckError("unreadable"))),
        type,
        quality,
      );
    } catch {
      // a canvas the browser considers tainted can't be read back
      reject(new DeckError("unreadable"));
    }
  });
}

function canvasFor(width: number, height: number, side: number): HTMLCanvasElement {
  const scale = side / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return canvas;
}

// PNG keeps sharp edges; a busy, photo-like slide falls back to JPEG on white
async function encode(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const png = await toBlob(canvas, "image/png");
  if (png.size <= MAX_PICTURE_BYTES) return new File([png], `${name}.png`, { type: "image/png" });
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const context = flat.getContext("2d");
  if (!context) throw new DeckError("unreadable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, flat.width, flat.height);
  context.drawImage(canvas, 0, 0);
  for (const quality of [0.9, 0.8, 0.65]) {
    const jpeg = await toBlob(flat, "image/jpeg", quality);
    if (jpeg.size <= MAX_PICTURE_BYTES) {
      return new File([jpeg], `${name}.jpg`, { type: "image/jpeg" });
    }
  }
  throw new DeckError("tooBig");
}

function svgSize(svg: string): { width: number; height: number } {
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  const width = Number(box?.[1]);
  const height = Number(box?.[2]);
  return width > 0 && height > 0 ? { width, height } : { width: 960, height: 540 };
}

function runWorker(bytes: ArrayBuffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pptx.worker.ts", import.meta.url), { type: "module" });
    const stop = (error: DeckError | null, svgs: string[] = []) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(svgs);
    };
    const timer = setTimeout(() => stop(new DeckError("timeout")), DECK_LIMITS.seconds * 1000);
    worker.onmessage = (event: MessageEvent<DeckResponse>) =>
      event.data.ok ? stop(null, event.data.svgs) : stop(new DeckError(event.data.reason));
    worker.onerror = () => stop(new DeckError("unreadable"));
    worker.postMessage({ bytes }, [bytes]);
  });
}

async function readPptx(file: File, base: string): Promise<Deck> {
  const svgs = await runWorker(await file.arrayBuffer());
  const urls: string[] = [];
  const slides = svgs.map((svg, index): DeckSlide => {
    const preview = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    urls.push(preview);
    const { width, height } = svgSize(svg);
    return {
      number: index + 1,
      width,
      height,
      preview,
      render: async () => {
        const image = await loadImage(preview);
        const canvas = canvasFor(width, height, RASTER_SIDE);
        const context = canvas.getContext("2d");
        if (!context) throw new DeckError("unreadable");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return encode(canvas, `${base}-${index + 1}`);
      },
    };
  });
  return {
    name: file.name,
    slides,
    dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

async function readPdf(file: File, base: string): Promise<Deck> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
    maxImageSize: 64 * 1024 * 1024,
  });
  const timer = setTimeout(() => void task.destroy(), DECK_LIMITS.seconds * 1000);
  const pdf = await task.promise
    .catch(() => {
      throw new DeckError(task.destroyed ? "timeout" : "unreadable");
    })
    .finally(() => clearTimeout(timer));
  const draw = async (number: number, side: number) => {
    const page = await pdf.getPage(number);
    const unit = page.getViewport({ scale: 1 });
    const canvas = canvasFor(unit.width, unit.height, side);
    const viewport = page.getViewport({ scale: canvas.width / unit.width });
    await page.render({ canvas, viewport }).promise;
    return { canvas, width: unit.width, height: unit.height };
  };
  const urls: string[] = [];
  const slides: DeckSlide[] = [];
  for (let number = 1; number <= Math.min(pdf.numPages, DECK_LIMITS.slides); number += 1) {
    const { canvas, width, height } = await draw(number, PREVIEW_SIDE);
    const preview = URL.createObjectURL(await toBlob(canvas, "image/png"));
    urls.push(preview);
    slides.push({
      number,
      width,
      height,
      preview,
      render: async () => encode((await draw(number, RASTER_SIDE)).canvas, `${base}-${number}`),
    });
  }
  if (slides.length === 0) throw new DeckError("empty");
  return {
    name: file.name,
    slides,
    dispose: () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      void task.destroy();
    },
  };
}

export function isDeckFile(file: File): boolean {
  return /\.(pptx|pdf)$/i.test(file.name) || file.type === "application/pdf";
}

/** Reads a deck's slides; throws a DeckError the caller can explain. */
export async function readDeck(file: File): Promise<Deck> {
  if (file.size > DECK_LIMITS.fileMb * 1024 * 1024) throw new DeckError("tooBig");
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const base =
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w-]+/g, "_")
      .slice(0, 40) || "slide";
  // check the bytes, not the name: a PDF starts with %PDF-, a .pptx is a zip (PK)
  if (String.fromCharCode(...head) === "%PDF-") return readPdf(file, base);
  if (head[0] === 0x50 && head[1] === 0x4b) return readPptx(file, base);
  throw new DeckError("kind");
}
