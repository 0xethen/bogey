import { strToU8, Zip, ZipPassThrough, zipSync } from "fflate";
import { csvChunks, type CsvCell, type CsvOptions } from "@bogey/utils/csv";
import { xlsxFiles } from "@bogey/utils/xlsx";

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const NO_STORE = "private, no-store";

export function csvResponse(
  filename: string,
  header: Tuple<string>,
  rows: Iterable<Tuple<CsvCell>>,
  options: CsvOptions = { bom: true },
): Response {
  const encoder = new TextEncoder();
  const chunks = csvChunks(header, rows, options);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": NO_STORE,
    },
  });
}

export function xlsxResponse(
  filename: string,
  sheet: string,
  header: Tuple<string>,
  rows: Iterable<Tuple<CsvCell>>,
): Response {
  const files = Object.fromEntries(
    Object.entries(xlsxFiles(sheet, header, rows)).map(([path, xml]) => [path, strToU8(xml)]),
  );
  return new Response(zipSync(files, { level: 6 }), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": NO_STORE,
    },
  });
}

export type ZipEntry = {
  name: string;
  chunks: AsyncIterable<Uint8Array>;
};

export function zipResponse(filename: string, entries: AsyncIterable<ZipEntry>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        for await (const entry of entries) {
          const file = new ZipPassThrough(entry.name);
          zip.add(file);
          for await (const chunk of entry.chunks) file.push(chunk);
          file.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": NO_STORE,
    },
  });
}
