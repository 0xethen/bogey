import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconDownload } from "@tabler/icons-react";
import { criteriaQueryOptions, projectExportAccessQueryOptions } from "@bogey/db/queries/judging";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bogey/ui/components/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Spinner } from "@bogey/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import {
  availableColumns,
  columnId,
  columnNeed,
  isExportAccess,
  presetColumns,
  PROJECT_FIELDS,
  PROJECT_PRESETS,
  projectExportHref,
  type ProjectColumn,
  type ProjectExportFormat,
  type ProjectPreset,
} from "#/lib/project-export.ts";
import { useT } from "#/lib/translate.tsx";

const PRESET_LABELS = {
  basic: "projectExport.preset.basic",
  results: "projectExport.preset.results",
  judging: "projectExport.preset.judging",
  everything: "projectExport.preset.everything",
} as const satisfies Record<ProjectPreset, string>;

// the projects spreadsheet: a preset or hand-picked columns, as CSV or Excel
export function ProjectExport({
  event,
  formKey,
  trigger,
}: {
  event: { id: string; slug: string };
  formKey?: string;
  trigger: ReactElement;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("projectExport.title")}</DialogTitle>
          <DialogDescription>{t("projectExport.intro")}</DialogDescription>
        </DialogHeader>
        {open && <ExportForm event={event} formKey={formKey} />}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({ event, formKey }: { event: { id: string; slug: string }; formKey?: string }) {
  const t = useT();
  const forms = useQuery(submissionFormsQueryOptions(event.id));
  const criteria = useQuery(criteriaQueryOptions(event.id));
  const access = useQuery(projectExportAccessQueryOptions(event.id));
  const [formChoice, setFormChoice] = useState(formKey);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [format, setFormat] = useState<ProjectExportFormat>("xlsx");
  const [tried, setTried] = useState(false);

  if (!forms.data || !criteria.data || !access.data) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const level = isExportAccess(access.data) ? access.data : "off";
  const form = forms.data.find((candidate) => candidate.key === formChoice) ?? forms.data[0];
  if (!form) return <p className="text-muted-fg">{t("manageSubs.noForm")}</p>;

  const available = availableColumns(form.items, criteria.data, level);
  const presets = PROJECT_PRESETS.filter((preset) => presetColumns(preset, available).length > 0);
  const selected = picked ?? presetColumns("basic", available).map(columnId);
  const columns = available.filter((column) => selected.includes(columnId(column)));
  const same = (preset: ProjectPreset) => {
    const ids = presetColumns(preset, available).map(columnId);
    return ids.length === selected.length && ids.every((id) => selected.includes(id));
  };
  const preset = presets.find(same) ?? "custom";

  const itemLabels = new Map(form.items.map((item) => [item.key, item.label]));
  const criterionLabels = new Map(
    criteria.data.map((criterion) => [criterion.id, criterion.label]),
  );
  const label = (column: ProjectColumn) => {
    if (column.kind === "answer") return itemLabels.get(column.key) ?? column.key;
    if (column.kind === "criterion")
      return t("projectExport.criterionColumn", {
        criterion: criterionLabels.get(column.key) ?? column.key,
      });
    const field = PROJECT_FIELDS.find((candidate) => candidate.key === column.key);
    return field ? t(field.label) : column.key;
  };
  const groups = [
    {
      key: "project",
      title: t("projectExport.group.project"),
      columns: available.filter(
        (column) =>
          column.kind === "field" &&
          columnNeed(column) !== "results" &&
          column.key !== "awards" &&
          column.key !== "votes",
      ),
    },
    {
      key: "answers",
      title: t("projectExport.group.answers"),
      columns: available.filter((column) => column.kind === "answer"),
    },
    {
      key: "results",
      title: t("projectExport.group.results"),
      columns: available.filter(
        (column) =>
          column.kind === "criterion" ||
          columnNeed(column) === "results" ||
          (column.kind === "field" && (column.key === "awards" || column.key === "votes")),
      ),
    },
  ].filter((group) => group.columns.length > 0);

  const setGroup = (group: Tuple<ProjectColumn>, on: boolean) => {
    const ids = group.map(columnId);
    const rest = selected.filter((id) => !ids.includes(id));
    setPicked(on ? [...rest, ...ids] : rest);
  };

  return (
    <>
      <div className="-mx-6 overflow-y-auto px-6">
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            {forms.data.length > 1 && (
              <Field>
                <FieldLabel htmlFor="export-form">{t("projectExport.form")}</FieldLabel>
                <OptSelect
                  id="export-form"
                  value={form.key}
                  onChange={(next) => {
                    setFormChoice(next);
                    setPicked(null);
                  }}
                  options={forms.data.map((candidate) => ({
                    value: candidate.key,
                    label: candidate.title,
                  }))}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="export-preset">{t("projectExport.preset")}</FieldLabel>
              <OptSelect<ProjectPreset | "custom">
                id="export-preset"
                value={preset}
                onChange={(next) => {
                  if (next !== "custom") setPicked(presetColumns(next, available).map(columnId));
                }}
                options={[
                  ...presets.map((value) => ({ value, label: t(PRESET_LABELS[value]) })),
                  ...(preset === "custom"
                    ? [{ value: "custom" as const, label: t("projectExport.preset.custom") }]
                    : []),
                ]}
              />
            </Field>
          </div>
          {groups.map((group) => (
            <FieldSet key={group.key}>
              <div className="flex items-center justify-between gap-2">
                <FieldLegend variant="label" className="mb-0">
                  {group.title}
                </FieldLegend>
                <div className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setGroup(group.columns, true)}>
                    {t("projectExport.all")}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setGroup(group.columns, false)}>
                    {t("projectExport.none")}
                  </Button>
                </div>
              </div>
              <CheckboxGroup
                value={selected.filter((id) =>
                  group.columns.some((column) => columnId(column) === id),
                )}
                onValueChange={(next) => {
                  const ids = group.columns.map(columnId);
                  setPicked([...selected.filter((id) => !ids.includes(id)), ...next]);
                }}
                className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2"
              >
                {group.columns.map((column) => (
                  <label key={columnId(column)} className="flex min-w-0 items-center gap-2.5">
                    <Checkbox value={columnId(column)} />
                    <span className="truncate">{label(column)}</span>
                  </label>
                ))}
              </CheckboxGroup>
            </FieldSet>
          ))}
        </FieldGroup>
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <Tabs
          value={format}
          onValueChange={(next: ProjectExportFormat) => setFormat(next)}
          className="gap-0"
        >
          <TabsList variant="switch" aria-label={t("projectExport.format")}>
            <TabsTrigger value="xlsx">{t("projectExport.xlsx")}</TabsTrigger>
            <TabsTrigger value="csv">{t("projectExport.csv")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          {tried && columns.length === 0 && <FieldError>{t("projectExport.pickOne")}</FieldError>}
          <Button
            render={
              <a
                href={projectExportHref(event.slug, { form: form.key, columns, format })}
                download
                onClick={(click) => {
                  setTried(true);
                  if (columns.length === 0) click.preventDefault();
                }}
              />
            }
            nativeButton={false}
          >
            <IconDownload />
            {t("projectExport.download")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
