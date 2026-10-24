// Turns a .pptx into one SVG per slide off the main thread; slides.ts can stop it at any time.
import { unzipSync } from "fflate";
import { convertPptxToSvg } from "pptx-glimpse";
import {
  DECK_LIMITS,
  type DeckProblem,
  type DeckRequest,
  type DeckResponse,
} from "./slide-limits.ts";

// declared sizes bound what fflate inflates, so checking them first stops zip bombs
function checkPackage(bytes: Uint8Array): DeckProblem | null {
  let entries = 0;
  let total = 0;
  let oversized = false;
  unzipSync(bytes, {
    filter: (file) => {
      entries += 1;
      total += file.originalSize;
      if (file.originalSize > DECK_LIMITS.entryBytes) oversized = true;
      return false;
    },
  });
  if (entries > DECK_LIMITS.entries || total > DECK_LIMITS.unzippedBytes || oversized) {
    return "tooBig";
  }
  return null;
}

addEventListener("message", async (event: MessageEvent<DeckRequest>) => {
  const reply = (response: DeckResponse) => postMessage(response);
  try {
    const bytes = new Uint8Array(event.data.bytes);
    const problem = checkPackage(bytes);
    if (problem) return reply({ ok: false, reason: problem });
    const slides = Array.from({ length: DECK_LIMITS.slides }, (_, index) => index + 1);
    const report = await convertPptxToSvg(bytes, { slides, logLevel: "off" });
    const svgs = report.slides
      .map((slide) => slide.svg)
      .filter((svg) => svg.length <= DECK_LIMITS.svgChars);
    reply(svgs.length > 0 ? { ok: true, svgs } : { ok: false, reason: "empty" });
  } catch {
    reply({ ok: false, reason: "unreadable" });
  }
});
