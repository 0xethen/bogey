import { expect, test } from "vite-plus/test";
import {
  certificateFolder,
  certificateLayoutFromMarkdown,
  certificateLayoutPaths,
  certificateRuns,
  defaultCertificateLayout,
  parseCertificateLayout,
  turnCertificatePage,
  CERTIFICATE_KINDS,
  DEFAULT_CERTIFICATE_BODY,
  eventDates,
  fillCertificate,
  isCertificateKind,
} from "../src/certificate.ts";

test("variables are filled in and unknown ones come out empty", () => {
  expect(
    fillCertificate("Hi {{name}} at {{ event }}{{nope}}.", { name: "Ada", event: "Fall Hack" }),
  ).toBe("Hi Ada at Fall Hack.");
});

test("every kind has wording that names the person and the event", () => {
  for (const kind of CERTIFICATE_KINDS) {
    expect(DEFAULT_CERTIFICATE_BODY[kind]).toContain("{{name}}");
    expect(DEFAULT_CERTIFICATE_BODY[kind]).toContain("{{event}}");
  }
  expect(isCertificateKind("award")).toBe(true);
  expect(isCertificateKind("mentor")).toBe(false);
});

test("event dates read as one day, a range in a month, or a longer span", () => {
  expect(eventDates("2026-10-09T13:00:00Z", "2026-10-09T20:00:00Z")).toBe("October 9, 2026");
  expect(eventDates("2026-10-09T13:00:00Z", "2026-10-10T20:00:00Z")).toBe("October 9–10, 2026");
  expect(eventDates("2026-10-30T13:00:00Z", "2026-11-01T20:00:00Z")).toBe(
    "October 30, 2026 – November 1, 2026",
  );
  expect(eventDates(null, null)).toBe("");
});

test("wording becomes centered text boxes, headings bigger, with the QR code under them", () => {
  const layout = certificateLayoutFromMarkdown(
    "# Hello\n\nto **{{name}}**",
    "landscape",
    "https://x.test/bg.png",
  );
  const [title, body, qr, link] = layout.layers;
  expect(title).toMatchObject({
    type: "text",
    text: "Hello",
    size: 32,
    bold: true,
    align: "center",
  });
  expect(body).toMatchObject({ type: "text", text: "to **{{name}}**", size: 14, bold: false });
  expect(qr).toMatchObject({ type: "qr", w: 22, h: 22 });
  expect(link).toMatchObject({ type: "text", text: "{{link}}" });
  expect(body!.y).toBeGreaterThan(title!.y + title!.h);
  expect(qr!.y + qr!.h).toBeLessThanOrEqual(210);
  expect(layout.background).toEqual({
    color: "#ffffff",
    image: { url: "https://x.test/bg.png" },
    frame: true,
  });
});

test("every kind's standard design names the person", () => {
  for (const kind of CERTIFICATE_KINDS) {
    const layout = defaultCertificateLayout(kind, "portrait");
    expect(
      layout.layers.some((layer) => layer.type === "text" && layer.text.includes("{{name}}")),
    ).toBe(true);
  }
});

test("a stored design is read leniently: broken layers drop, odd values fall back", () => {
  const layout = parseCertificateLayout({
    background: { color: "red", image: { url: "javascript:alert(1)" } },
    layers: [
      {
        type: "text",
        id: "a",
        x: 10,
        y: 10,
        w: 50,
        h: 10,
        text: "Hi",
        size: 900,
        color: "#123456",
        align: "left",
      },
      { type: "image", id: "b", x: 0, y: 0, w: 10, h: 10, image: { url: "ftp://nope" } },
      { type: "shape" },
      {
        type: "image",
        id: "c",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        image: { url: "https://s.test/e/a.png", path: "e/a.png" },
      },
    ],
  });
  expect(layout.background).toEqual({ color: "#ffffff", image: null, frame: false });
  expect(layout.layers.map((layer) => layer.id)).toEqual(["a", "c"]);
  expect(layout.layers[0]).toMatchObject({
    size: 200,
    color: "#123456",
    align: "left",
    font: "sans",
  });
  expect(certificateLayoutPaths(layout)).toEqual(["e/a.png"]);
  expect(parseCertificateLayout(null).layers).toEqual([]);
});

test("turning the page scales layers and keeps the QR code square", () => {
  const layout = defaultCertificateLayout("judge", "landscape");
  const turned = turnCertificatePage(layout, "landscape", "portrait");
  const qr = turned.layers.find((layer) => layer.type === "qr")!;
  expect(qr.w).toBe(qr.h);
  for (const layer of turned.layers) expect(layer.x + layer.w).toBeLessThanOrEqual(210.1);
});

test("uploads go in the event's folder, or the organization's", () => {
  expect(certificateFolder({ orgId: "o", eventId: "e", kind: "award" })).toBe(
    "e/certificates/award",
  );
  expect(certificateFolder({ orgId: "o", eventId: null, kind: "award" })).toBe(
    "org/o/certificates/award",
  );
});

test("text boxes split into bold and italic runs", () => {
  expect(certificateRuns("a **b** *c* d")).toEqual([
    { text: "a ", bold: false, italic: false },
    { text: "b", bold: true, italic: false },
    { text: " ", bold: false, italic: false },
    { text: "c", bold: false, italic: true },
    { text: " d", bold: false, italic: false },
  ]);
});
