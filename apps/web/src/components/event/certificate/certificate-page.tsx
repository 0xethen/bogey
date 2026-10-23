import type { CSSProperties } from "react";
import {
  CERTIFICATE_PAGES,
  certificateRuns,
  fillCertificate,
  pointsToMm,
  type CertificateLayer,
  type CertificateLayout,
  type CertificateOrientation,
} from "@bogey/utils/certificate";
import { cn } from "@bogey/ui/lib/utils";
import { QrCode } from "#/components/event/qr-code.tsx";

const FONTS = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', ui-serif, serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, monospace",
} as const;

/** Lengths in millimetres as a share of the page's width, so the page draws the same at any size
 * and prints at exactly A4. */
function cqw(mm: number, pageWidth: number): string {
  return `${(mm / pageWidth) * 100}cqw`;
}

export type CertificateValues = {
  name: string;
  event: string;
  org: string;
  award: string;
  date: string;
  code: string;
  link: string;
};

/** One layer's content, filling its box; placeholders stay as typed when `values` is null. */
export function CertificateLayerView({
  layer,
  orientation,
  values,
  qrValue,
  qrLabel,
}: {
  layer: CertificateLayer;
  orientation: CertificateOrientation;
  values: Readonly<CertificateValues> | null;
  qrValue: string;
  qrLabel: string;
}) {
  const page = CERTIFICATE_PAGES[orientation];
  if (layer.type === "qr") {
    return <QrCode value={qrValue} size={96} label={qrLabel} className="size-full" />;
  }
  if (layer.type === "image") {
    return (
      <img
        src={layer.image.url}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={cn("size-full", layer.fit === "cover" ? "object-cover" : "object-contain")}
      />
    );
  }
  const style: CSSProperties = {
    fontFamily: FONTS[layer.font],
    fontSize: cqw(pointsToMm(layer.size), page.width),
    fontWeight: layer.bold ? 700 : 400,
    fontStyle: layer.italic ? "italic" : "normal",
    textAlign: layer.align,
    justifyContent:
      layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center",
    color: layer.color,
  };
  return (
    <div
      className="flex size-full items-center leading-[1.25] break-words whitespace-pre-wrap"
      style={style}
    >
      <span className="w-full">
        {certificateRuns(layer.text).map((run, index) => {
          const text = values ? fillCertificate(run.text, values) : run.text;
          if (run.bold) return <strong key={index}>{text}</strong>;
          if (run.italic) return <em key={index}>{text}</em>;
          return <span key={index}>{text}</span>;
        })}
      </span>
    </div>
  );
}

/** A whole certificate: what the editor's preview, the verification page and printing all draw. */
export function CertificatePage({
  layout,
  orientation,
  values,
  qrValue,
  qrLabel,
  className,
}: {
  layout: CertificateLayout;
  orientation: CertificateOrientation;
  values: Readonly<CertificateValues> | null;
  qrValue: string;
  qrLabel: string;
  className?: string;
}) {
  const page = CERTIFICATE_PAGES[orientation];
  return (
    <div
      data-orientation={orientation}
      className={cn(
        "certificate-page relative w-full overflow-hidden text-black [container-type:inline-size] [print-color-adjust:exact]",
        className,
      )}
      style={{
        aspectRatio: `${page.width} / ${page.height}`,
        backgroundColor: layout.background.color,
      }}
    >
      <CertificateBackdrop layout={layout} orientation={orientation} />
      {layout.layers.map((layer) => (
        <div
          key={layer.id}
          className="absolute"
          style={{
            left: `${(layer.x / page.width) * 100}%`,
            top: `${(layer.y / page.height) * 100}%`,
            width: `${(layer.w / page.width) * 100}%`,
            height: `${(layer.h / page.height) * 100}%`,
          }}
        >
          <CertificateLayerView
            layer={layer}
            orientation={orientation}
            values={values}
            qrValue={qrValue}
            qrLabel={qrLabel}
          />
        </div>
      ))}
    </div>
  );
}

/** The background picture and frame, also drawn under the editor's layers. */
export function CertificateBackdrop({
  layout,
  orientation,
}: {
  layout: CertificateLayout;
  orientation: CertificateOrientation;
}) {
  const page = CERTIFICATE_PAGES[orientation];
  return (
    <>
      {layout.background.image && (
        <img
          src={layout.background.image.url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {layout.background.frame && (
        <div
          aria-hidden
          className="absolute border-double border-black/70"
          style={{
            inset: `${(6 / page.height) * 100}% ${(6 / page.width) * 100}%`,
            borderWidth: cqw(1.2, page.width),
          }}
        />
      )}
    </>
  );
}
