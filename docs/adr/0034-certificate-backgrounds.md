# 0034: Certificate pages designed elsewhere come in as pictures, read in the browser

**Status:** accepted (2026-10-24).

## Context

Organizers want to design certificates in a real tool (PowerPoint, Keynote, Canva, Figma) and only
add the names and codes in Bogey. Two questions came with that:

1. Should Bogey's own editor (an A4 `Stage` from `@bogey/ui` with text, picture and QR layers, about
   800 lines) be replaced by a designer package?
2. How does a `.pptx`, which can be anything an attacker uploads, get onto the page?

## Decision

**Keep the editor.** A designer package would replace the stage, not the work around it: the layout
format, its SQL checks, the copy-to-event flow, the file cleanup, printing at exact A4 and the
verification page all stay ours. What we looked at:

- `@shadcn/designer`: the right look, but a commercial license.
- Polotno: commercial; its open forks are young and unproven.
- fabric.js and Konva (MIT): canvas engines, so the certificate would be drawn twice (canvas to edit,
  HTML to print and verify) or printed as a bitmap; more code, not less.
- tldraw: its license requires a key or a watermark in production.
- GrapesJS and craft.js: page builders, far more than an A4 page with a few boxes needs.

**Pages designed elsewhere become the background picture.** The design keeps one background image
(`background.image`, with `fit`: cover, contain or stretch), and the layers sit on top.

- PNG, JPG, WebP, GIF and SVG upload as they are, into event-assets like any picture.
- A `.pdf` is read with `pdfjs-dist` (Mozilla's pdf.js, Apache-2.0), the viewer Firefox ships, so it
  is hardened against hostile files; each page renders to a canvas.
- A `.pptx` is read with `pptx-glimpse` (MIT), which turns slides into SVG without a server. It runs
  in a Web Worker that is stopped after 90 seconds, and before it runs, the zip's directory is
  checked: at most 5,000 entries, 100 MB per entry and 400 MB in all. fflate inflates into buffers of
  the declared size, so a zip that lies about its sizes can't grow past them. The file itself can be
  up to 50 MB, and the first 60 slides are read.
- The picked slide is drawn onto a canvas at about 200 dpi (2400 px on the long side) and uploaded
  as a PNG, or a JPEG when the PNG would pass the bucket's 5 MB limit. Only that picture leaves the
  browser; the deck never does.

## Consequences

- Nothing on the server parses decks, so a hostile file can only hurt the tab of the organizer who
  picked it. The stored result is a plain picture, served like every other upload.
- `.pptx` slides are redrawn by a young library: fonts fall back to what the browser has, and some
  effects come out simpler. The import says so and suggests exporting the deck as a PDF, which is
  exact. If `pptx-glimpse` stops being maintained, the PDF path covers the same need and the `.pptx`
  path can be dropped without touching stored designs.
- Text that was on a slide is part of the picture. Names, dates and codes are added as text layers
  in Bogey, which is what the editor is for.
- Both libraries load only when someone opens a deck, so they cost nothing on other pages.
