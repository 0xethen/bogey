import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowUp,
  IconBold,
  IconCopy,
  IconItalic,
  IconPhotoPlus,
  IconQrcode,
  IconTextPlus,
  IconTrash,
} from "@tabler/icons-react";
import { saveCertificateDesignFn, type DesignScope } from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_MAX_LAYERS,
  CERTIFICATE_PAGES,
  CERTIFICATE_VARIABLES,
  certificateFolder,
  turnCertificatePage,
  type CertificateAlign,
  type CertificateFont,
  type CertificateImage,
  type CertificateKind,
  type CertificateLayer,
  type CertificateLayout,
  type CertificateOrientation,
  type CertificateTextLayer,
} from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Input } from "@bogey/ui/components/input";
import { Label } from "@bogey/ui/components/label";
import { NumberInput } from "@bogey/ui/components/number-field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Panel } from "@bogey/ui/components/panel";
import { Stage, type StageItem, type StageRect } from "@bogey/ui/components/stage";
import { Switch } from "@bogey/ui/components/switch";
import { Textarea } from "@bogey/ui/components/textarea";
import { toast } from "@bogey/ui/components/toast";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@bogey/ui/components/toolbar";
import { useUnsavedEntry } from "@bogey/ui/lib/unsaved";
import {
  CertificateBackdrop,
  CertificateLayerView,
  CertificatePage,
  type CertificateValues,
} from "#/components/event/certificate/certificate-page.tsx";
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_MB,
  uploadImage,
} from "#/components/event/submission/image-input.tsx";
import { useT, type T } from "#/lib/translate.tsx";

export interface CertificateDraft {
  layout: CertificateLayout;
  orientation: CertificateOrientation;
}

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function same(a: CertificateDraft, b: CertificateDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The picture's height over its width, so a new picture keeps its shape. */
function aspect(url: string): Promise<number> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve(image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1);
    image.onerror = () => resolve(1);
    image.src = url;
  });
}

function layerLabel(layer: CertificateLayer, t: T): string {
  if (layer.type === "qr") return t("certDesign.layerQr");
  if (layer.type === "image") return t("certDesign.layerPicture");
  return t("certDesign.layerText", { text: layer.text.slice(0, 40) });
}

/**
 * Edits one kind of certificate's design on an A4 stage, with a preview for a sample recipient
 * beside it. Changes join the save bar; files that stop being used are removed when it's saved.
 */
export function CertificateEditor({
  scope,
  kind,
  kindName,
  initial,
  saved,
  sample,
}: {
  scope: DesignScope;
  kind: CertificateKind;
  kindName: string;
  /** What editing starts from. */
  initial: CertificateDraft;
  /** Whether `initial` is already stored; if not, it's only saved once changed. */
  saved: boolean;
  sample: Omit<CertificateValues, "name">;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [sampleName, setSampleName] = useState(() => t("certDesign.sampleNameValue"));
  const page = CERTIFICATE_PAGES[draft.orientation];
  const folder = certificateFolder({ orgId: scope.orgId, eventId: scope.eventId, kind });

  const save = useMutation({
    mutationFn: async (next: CertificateDraft) =>
      unwrap(
        await saveCertificateDesignFn({
          data: { ...scope, kind, layout: next.layout, orientation: next.orientation },
        }),
      ),
    onSuccess: async (_, next) => {
      setBase(next);
      toast.add({ title: t("certDesign.saved") });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });

  useUnsavedEntry({
    dirty: !same(draft, base),
    save: async () => {
      try {
        await save.mutateAsync(draft);
        return true;
      } catch {
        return false;
      }
    },
    reset: () => {
      setDraft(base);
      setSelected(null);
    },
  });
  const unsavedStandard = !saved && same(base, initial);

  const setLayout = (change: (layout: CertificateLayout) => CertificateLayout) =>
    setDraft((current) => ({ ...current, layout: change(current.layout) }));
  const updateLayer = (id: string, change: Partial<CertificateLayer>) =>
    setLayout((layout) => ({
      ...layout,
      layers: layout.layers.map((layer) =>
        layer.id === id ? ({ ...layer, ...change } as CertificateLayer) : layer,
      ),
    }));
  const addLayer = (layer: CertificateLayer) => {
    setLayout((layout) => ({ ...layout, layers: [...layout.layers, layer] }));
    setSelected(layer.id);
  };
  const removeLayer = (id: string) => {
    setLayout((layout) => ({ ...layout, layers: layout.layers.filter((each) => each.id !== id) }));
    setSelected(null);
  };
  const moveLayer = (id: string, by: number) =>
    setLayout((layout) => {
      const layers = [...layout.layers];
      const from = layers.findIndex((layer) => layer.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= layers.length) return layout;
      const [layer] = layers.splice(from, 1);
      layers.splice(to, 0, layer!);
      return { ...layout, layers };
    });

  const full = draft.layout.layers.length >= CERTIFICATE_MAX_LAYERS;
  const hasQr = draft.layout.layers.some((layer) => layer.type === "qr");

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const stored = await uploadImage(folder, file, t);
      return { image: { url: stored.url, path: stored.path }, ratio: await aspect(stored.url) };
    },
  });
  const addPicture = (file: File) =>
    upload.mutate(file, {
      onSuccess: ({ image, ratio }) => {
        const w = Math.min(60, page.width / 2);
        const h = Math.min(page.height / 2, Math.round(w * ratio * 2) / 2);
        addLayer({
          id: newId(),
          type: "image",
          image,
          fit: "contain",
          x: Math.round((page.width - w) / 2),
          y: Math.round((page.height - h) / 2),
          w,
          h,
        });
      },
    });
  const picker = useRef<HTMLInputElement>(null);

  const items = useMemo(
    (): StageItem[] =>
      draft.layout.layers.map((layer) => ({
        id: layer.id,
        x: layer.x,
        y: layer.y,
        w: layer.w,
        h: layer.h,
        label: layerLabel(layer, t),
        square: layer.type === "qr",
      })),
    [draft.layout.layers, t],
  );
  const layerById = new Map(draft.layout.layers.map((layer) => [layer.id, layer]));
  const current = selected ? layerById.get(selected) : undefined;
  const values: CertificateValues = {
    ...sample,
    name: sampleName || t("certDesign.sampleNameValue"),
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar aria-label={t("certDesign.tools")} className="flex-wrap">
        <ToolbarGroup>
          <ToolbarButton
            size="sm"
            disabled={full}
            tooltip={full ? t("certDesign.tooMany", { max: CERTIFICATE_MAX_LAYERS }) : undefined}
            onClick={() =>
              addLayer({
                id: newId(),
                type: "text",
                text: t("certDesign.newText"),
                x: 20,
                y: Math.round(page.height / 2 - 6),
                w: page.width - 40,
                h: 12,
                size: 18,
                font: "sans",
                bold: false,
                italic: false,
                align: "center",
                color: "#000000",
              })
            }
          >
            <IconTextPlus />
            {t("certDesign.addText")}
          </ToolbarButton>
          <ToolbarButton
            size="sm"
            disabled={full || upload.isPending}
            tooltip={full ? t("certDesign.tooMany", { max: CERTIFICATE_MAX_LAYERS }) : undefined}
            onClick={() => picker.current?.click()}
          >
            <IconPhotoPlus />
            {upload.isPending ? t("image.uploading") : t("certDesign.addPicture")}
          </ToolbarButton>
          <ToolbarButton
            size="sm"
            disabled={full || hasQr}
            tooltip={
              full
                ? t("certDesign.tooMany", { max: CERTIFICATE_MAX_LAYERS })
                : hasQr
                  ? t("certDesign.qrOnce")
                  : undefined
            }
            onClick={() =>
              addLayer({
                id: "qr",
                type: "qr",
                x: page.width - 40,
                y: page.height - 40,
                w: 25,
                h: 25,
              })
            }
          >
            <IconQrcode />
            {t("certDesign.addQr")}
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Label className="sr-only" htmlFor={`${folder}-orientation`}>
            {t("manageCerts.orientation")}
          </Label>
          <OptSelect
            id={`${folder}-orientation`}
            size="sm"
            value={draft.orientation}
            options={[
              {
                value: "landscape",
                label: t("manageCerts.landscape", { width: "297 mm", height: "210 mm" }),
              },
              {
                value: "portrait",
                label: t("manageCerts.portrait", { width: "210 mm", height: "297 mm" }),
              },
            ]}
            onChange={(to) =>
              setDraft((current) => ({
                orientation: to,
                layout: turnCertificatePage(current.layout, current.orientation, to),
              }))
            }
          />
        </ToolbarGroup>
        <input
          ref={picker}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={t("image.choose")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) addPicture(file);
          }}
        />
      </Toolbar>
      <ErrorAlert error={upload.error} title={t("image.failed")} />
      {full && (
        <p className="text-sm text-muted-fg">
          {t("certDesign.tooMany", { max: CERTIFICATE_MAX_LAYERS })}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2" aria-label={t("certDesign.canvas")}>
          <h3 className="text-sm font-medium">{t("certDesign.canvas")}</h3>
          <div className="[container-type:inline-size]">
            <Stage
              width={page.width}
              height={page.height}
              items={items}
              selected={selected}
              onSelect={setSelected}
              onChange={(id: string, rect: StageRect) => updateLayer(id, rect)}
              onRemove={removeLayer}
              label={t("certDesign.stage", { kind: kindName })}
              className="border border-border bg-white shadow-sm"
              renderItem={(item) => {
                const layer = layerById.get(item.id);
                return layer ? (
                  <CertificateLayerView
                    layer={layer}
                    orientation={draft.orientation}
                    values={null}
                    qrValue={`https://${sample.link}`}
                    qrLabel={t("certificates.scan")}
                  />
                ) : null;
              }}
            >
              <div
                className="absolute inset-0"
                style={{ backgroundColor: draft.layout.background.color }}
              >
                <CertificateBackdrop layout={draft.layout} orientation={draft.orientation} />
              </div>
            </Stage>
          </div>
        </section>
        <section className="flex min-w-0 flex-col gap-2" aria-label={t("certDesign.preview")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("certDesign.preview")}</h3>
            <div className="flex items-center gap-2">
              <Label htmlFor={`${folder}-sample`} className="text-xs text-muted-fg">
                {t("certDesign.sampleName")}
              </Label>
              <Input
                id={`${folder}-sample`}
                className="h-8 w-48"
                value={sampleName}
                maxLength={80}
                onChange={(event) => setSampleName(event.target.value)}
              />
            </div>
          </div>
          <CertificatePage
            layout={draft.layout}
            orientation={draft.orientation}
            values={values}
            qrValue={`https://${sample.link}`}
            qrLabel={t("certificates.scan")}
            className="border border-border shadow-sm"
          />
        </section>
      </div>

      <Panel
        size="sm"
        title={current ? layerLabel(current, t) : t("certDesign.page")}
        description={current ? undefined : t("certDesign.selectHint")}
      >
        <div className="flex flex-col gap-4 p-(--panel-spacing) pt-0">
          {current ? (
            <LayerInspector
              key={current.id}
              layer={current}
              folder={folder}
              onChange={(change) => updateLayer(current.id, change)}
              actions={
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveLayer(current.id, 1)}
                    disabled={draft.layout.layers.at(-1)?.id === current.id}
                  >
                    <IconArrowUp />
                    {t("certDesign.forward")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveLayer(current.id, -1)}
                    disabled={draft.layout.layers[0]?.id === current.id}
                  >
                    <IconArrowDown />
                    {t("certDesign.backward")}
                  </Button>
                  {current.type !== "qr" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={full}
                      tooltip={
                        full ? t("certDesign.tooMany", { max: CERTIFICATE_MAX_LAYERS }) : undefined
                      }
                      onClick={() =>
                        addLayer({
                          ...current,
                          id: newId(),
                          x: Math.min(current.x + 5, page.width - current.w),
                          y: Math.min(current.y + 5, page.height - current.h),
                        })
                      }
                    >
                      <IconCopy />
                      {t("certDesign.duplicate")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => removeLayer(current.id)}>
                    <IconTrash />
                    {t("certDesign.remove")}
                  </Button>
                </div>
              }
            />
          ) : (
            <PageInspector
              layout={draft.layout}
              folder={folder}
              onChange={(background) =>
                setLayout((layout) => ({
                  ...layout,
                  background: { ...layout.background, ...background },
                }))
              }
            />
          )}
        </div>
      </Panel>
      <ErrorAlert error={save.error} />
      {unsavedStandard && <p className="text-sm text-muted-fg">{t("certDesign.standardHint")}</p>}
    </div>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-fg">
        {label}
      </Label>
      {children}
    </div>
  );
}

function PictureDrop({
  folder,
  image,
  onChange,
}: {
  folder: string;
  image: CertificateImage | null;
  onChange: (image: CertificateImage | null) => void;
}) {
  const t = useT();
  const upload = useMutation({
    mutationFn: (file: File) => uploadImage(folder, file, t),
    onSuccess: (stored) => onChange({ url: stored.url, path: stored.path }),
  });
  const name = image ? decodeURIComponent(image.url.slice(image.url.lastIndexOf("/") + 1)) : "";
  return (
    <div className="flex flex-col gap-2">
      <FileDrop
        files={
          image ? [{ id: image.url, name: name.replace(/^[0-9a-f-]{36}-/, ""), sizeBytes: 0 }] : []
        }
        accept={IMAGE_ACCEPT}
        maxMb={IMAGE_MAX_MB}
        multiple={false}
        busy={upload.isPending}
        onAdd={(files) => {
          if (files[0]) upload.mutate(files[0]);
        }}
        onRemove={() => onChange(null)}
      />
      <ErrorAlert error={upload.error} title={t("image.failed")} />
    </div>
  );
}

function PageInspector({
  layout,
  folder,
  onChange,
}: {
  layout: CertificateLayout;
  folder: string;
  onChange: (background: Partial<CertificateLayout["background"]>) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <div className="grid gap-4 md:grid-cols-[auto_1fr]">
      <div className="flex flex-col gap-4">
        <Row label={t("certDesign.backgroundColor")} htmlFor={`${id}-color`}>
          <Input
            id={`${id}-color`}
            type="color"
            className="h-9 w-20 p-1"
            value={layout.background.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </Row>
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-frame`}
            checked={layout.background.frame}
            onCheckedChange={(frame) => onChange({ frame })}
          />
          <Label htmlFor={`${id}-frame`}>{t("certDesign.frame")}</Label>
        </div>
      </div>
      <Row label={t("certDesign.background")}>
        <PictureDrop
          folder={folder}
          image={layout.background.image}
          onChange={(image) => onChange({ image })}
        />
      </Row>
    </div>
  );
}

const ALIGNS = [
  { value: "left", icon: IconAlignLeft, label: "certDesign.alignLeft" },
  { value: "center", icon: IconAlignCenter, label: "certDesign.alignCenter" },
  { value: "right", icon: IconAlignRight, label: "certDesign.alignRight" },
] as const satisfies readonly {
  value: CertificateAlign;
  icon: typeof IconAlignLeft;
  label: string;
}[];

function LayerInspector({
  layer,
  folder,
  onChange,
  actions,
}: {
  layer: CertificateLayer;
  folder: string;
  onChange: (change: Partial<CertificateLayer>) => void;
  actions: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const box = (key: "x" | "y" | "w" | "h", label: string) => (
    <Row label={label} htmlFor={`${id}-${key}`}>
      <NumberInput
        id={`${id}-${key}`}
        className="w-28"
        value={layer[key]}
        step={0.5}
        min={key === "w" || key === "h" ? 1 : 0}
        onValueChange={(value) => {
          if (value === null) return;
          if (layer.type === "qr" && (key === "w" || key === "h")) onChange({ w: value, h: value });
          else onChange({ [key]: value });
        }}
      />
    </Row>
  );
  return (
    <div className="flex flex-col gap-4">
      {layer.type === "text" && <TextFields layer={layer} onChange={onChange} />}
      {layer.type === "image" && (
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Row label={t("certDesign.replacePicture")}>
            <PictureDrop
              folder={folder}
              image={layer.image}
              onChange={(image) => {
                if (image) onChange({ image });
              }}
            />
          </Row>
          <Row label={t("certDesign.fit")} htmlFor={`${id}-fit`}>
            <OptSelect
              id={`${id}-fit`}
              value={layer.fit}
              options={[
                { value: "contain", label: t("certDesign.fitContain") },
                { value: "cover", label: t("certDesign.fitCover") },
              ]}
              onChange={(fit) => onChange({ fit })}
            />
          </Row>
        </div>
      )}
      {layer.type === "qr" && <p className="text-sm text-muted-fg">{t("certDesign.qrHelp")}</p>}
      <fieldset className="flex flex-wrap gap-3">
        <legend className="sr-only">{t("certDesign.position")}</legend>
        {box("x", t("certDesign.left"))}
        {box("y", t("certDesign.top"))}
        {box("w", t("certDesign.width"))}
        {box("h", t("certDesign.height"))}
      </fieldset>
      {actions}
    </div>
  );
}

function TextFields({
  layer,
  onChange,
}: {
  layer: CertificateTextLayer;
  onChange: (change: Partial<CertificateTextLayer>) => void;
}) {
  const t = useT();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (placeholder: string) => {
    const element = area.current;
    const at = element?.selectionStart ?? layer.text.length;
    const end = element?.selectionEnd ?? at;
    onChange({ text: `${layer.text.slice(0, at)}${placeholder}${layer.text.slice(end)}` });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(at + placeholder.length, at + placeholder.length);
    });
  };
  return (
    <>
      <Row label={t("certDesign.text")} htmlFor={`${id}-text`}>
        <Textarea
          ref={area}
          id={`${id}-text`}
          rows={3}
          maxLength={1000}
          value={layer.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-fg">{t("certDesign.insertLabel")}</span>
          {Object.keys(CERTIFICATE_VARIABLES).map((name) => (
            <Button
              key={name}
              size="xs"
              variant="outline"
              tooltip={CERTIFICATE_VARIABLES[name]}
              onClick={() => insert(`{{${name}}}`)}
            >
              {`{{${name}}}`}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-fg">{t("certDesign.textHelp")}</p>
      </Row>
      <div className="flex flex-wrap items-end gap-3">
        <Row label={t("certDesign.size")} htmlFor={`${id}-size`}>
          <NumberInput
            id={`${id}-size`}
            className="w-28"
            value={layer.size}
            min={4}
            max={200}
            onValueChange={(size) => {
              if (size !== null) onChange({ size });
            }}
          />
        </Row>
        <Row label={t("certDesign.font")} htmlFor={`${id}-font`}>
          <OptSelect<CertificateFont>
            id={`${id}-font`}
            value={layer.font}
            options={[
              { value: "sans", label: t("certDesign.fontSans") },
              { value: "serif", label: t("certDesign.fontSerif") },
              { value: "mono", label: t("certDesign.fontMono") },
            ]}
            onChange={(font) => onChange({ font })}
          />
        </Row>
        <Row label={t("certDesign.color")} htmlFor={`${id}-color`}>
          <Input
            id={`${id}-color`}
            type="color"
            className="h-9 w-16 p-1"
            value={layer.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </Row>
        <Toolbar aria-label={t("certDesign.style")}>
          <ToolbarButton
            aria-label={t("certDesign.bold")}
            aria-pressed={layer.bold}
            data-pressed={layer.bold ? "" : undefined}
            onClick={() => onChange({ bold: !layer.bold })}
          >
            <IconBold />
          </ToolbarButton>
          <ToolbarButton
            aria-label={t("certDesign.italic")}
            aria-pressed={layer.italic}
            data-pressed={layer.italic ? "" : undefined}
            onClick={() => onChange({ italic: !layer.italic })}
          >
            <IconItalic />
          </ToolbarButton>
          <ToolbarSeparator />
          {ALIGNS.map(({ value, icon: Icon, label }) => (
            <ToolbarButton
              key={value}
              aria-label={t(label)}
              aria-pressed={layer.align === value}
              data-pressed={layer.align === value ? "" : undefined}
              onClick={() => onChange({ align: value })}
            >
              <Icon />
            </ToolbarButton>
          ))}
        </Toolbar>
      </div>
    </>
  );
}
