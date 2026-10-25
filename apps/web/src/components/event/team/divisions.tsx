import { useMemo, type ReactNode } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chooseDivisionFn,
  eventDivisionsQueryOptions,
  myDivisionQueryOptions,
  type Division,
} from "@bogey/db/queries/divisions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@bogey/ui/components/field";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { RadioGroup, RadioGroupItem } from "@bogey/ui/components/radio-group";
import { useT, type T } from "#/lib/translate.tsx";

export function divisionRule(division: Pick<Division, "selectable" | "switchable">, t: T): string {
  if (!division.selectable) {
    return division.switchable ? t("division.placedSwitchable") : t("division.placedLocked");
  }
  return division.switchable ? t("division.switchable") : t("division.locked");
}

export function canMoveTo(current: Division | undefined, to: Division): boolean {
  if (current?.id === to.id) return true;
  return to.selectable && (!current || current.switchable);
}

export function DivisionChoices({
  divisions,
  value,
  current,
  onChange,
  idPrefix = "division",
  label,
}: {
  divisions: Tuple<Division>;
  value: string | null;
  current?: string | null;
  onChange: (id: string) => void;
  idPrefix?: string;
  label?: string;
}) {
  const t = useT();
  const now = divisions.find((division) => division.id === current);
  const picked = divisions.find((division) => division.id === value);
  // a division participants can't pick shows only when organizers say so, or to the people in it
  const shown = divisions.filter(
    (division) => division.selectable || division.visible || division.id === current,
  );
  return (
    <FieldSet>
      <FieldLegend>{label ?? t("division.yours")}</FieldLegend>
      <RadioGroup value={value ?? ""} onValueChange={(next) => onChange(String(next))}>
        {shown.map((division) => {
          const id = `${idPrefix}-${division.id}`;
          const allowed = canMoveTo(now, division);
          return (
            <FieldLabel key={division.id} htmlFor={id}>
              <Field orientation="horizontal" data-disabled={!allowed || undefined}>
                <RadioGroupItem value={division.id} id={id} disabled={!allowed} />
                <FieldContent>
                  <FieldTitle>
                    {division.name}
                    {division.id === current && (
                      <Badge variant="secondary">{t("division.yoursBadge")}</Badge>
                    )}
                  </FieldTitle>
                  {division.description && (
                    <FieldDescription>{division.description}</FieldDescription>
                  )}
                  {/* <FieldDescription className="text-xs">
                    {divisionRule(division, t)}
                  </FieldDescription> */}
                </FieldContent>
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>
      <FieldDescription>
        {now && !now.switchable
          ? t("division.inLocked", { name: now.name })
          : picked
            ? picked.switchable
              ? t("division.canSwitchLater", { name: picked.name })
              : t("division.cantSwitchLater", { name: picked.name })
            : t("division.pickHelp")}
      </FieldDescription>
    </FieldSet>
  );
}

export function ChooseDivision({
  eventId,
  divisions,
  current,
  submitLabel,
  onDone,
  secondary,
}: {
  eventId: string;
  divisions: Tuple<Division>;
  current: string | null;
  submitLabel?: string;
  onDone?: () => void;
  secondary?: ReactNode;
}) {
  const t = useT();
  const schema = useMemo(() => chooseDivisionSchema(t), [t]);
  const queryClient = useQueryClient();
  const choose = useMutation({
    mutationFn: async (divisionId: string) =>
      unwrap(await chooseDivisionFn({ data: { eventId, divisionId } }).catch(requestFailure)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["divisions", eventId] });
      await queryClient.invalidateQueries({ queryKey: myDivisionQueryOptions(eventId).queryKey });
    },
  });
  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { divisionId: current ?? "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      if (value.divisionId !== current) {
        try {
          await choose.mutateAsync(value.divisionId);
        } catch (error) {
          return createValidationError(
            error instanceof Error ? error.message : t("division.saveFailed"),
          );
        }
      }
      onDone?.();
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        <form.Field name="divisionId">
          {(field) => (
            <>
              <DivisionChoices
                divisions={divisions}
                value={field.value}
                current={current}
                label={schemaMetaOf(field).label}
                onChange={(next) => field.handleChange(next)}
              />
              <field.Error />
            </>
          )}
        </form.Field>
        <form.FormAlert title={t("division.saveFailed")} />
        <div className="flex flex-wrap gap-2">
          <form.Submit pending={`${t("common.saving")}...`}>
            {submitLabel ?? t("common.save")}
          </form.Submit>
          {secondary}
        </div>
      </form.Form>
    </form.AppForm>
  );
}

const chooseDivisionSchema = (t: T) =>
  z.object({
    divisionId: z
      .string()
      .min(1, t("division.pickFirst"))
      .meta({ label: t("division.yours") })
      .describe(t("division.pickHelp")),
  });

export const changeDivision = createDialogHandle<undefined>();

export function useMyDivision(eventId: string, enabled: boolean) {
  const divisions = useQuery({ ...eventDivisionsQueryOptions(eventId), enabled });
  const mine = useQuery({ ...myDivisionQueryOptions(eventId), enabled });
  const list = divisions.data ?? [];
  const current = list.find((division) => division.id === mine.data);
  return {
    loaded: divisions.isSuccess && mine.isSuccess,
    divisions: list,
    current,
    canChange: list.some((division) => division.id !== current?.id && canMoveTo(current, division)),
  };
}

export function DivisionDialog({
  eventId,
  divisions,
  current,
}: {
  eventId: string;
  divisions: Tuple<Division>;
  current: string | null;
}) {
  const t = useT();
  return (
    <Dialog handle={changeDivision}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? t("division.change") : t("division.pick")}</DialogTitle>
          <DialogDescription>{t("division.dialogHelp")}</DialogDescription>
        </DialogHeader>
        <ChooseDivision
          key={current ?? "none"}
          eventId={eventId}
          divisions={divisions}
          current={current}
          onDone={() => changeDivision.close()}
        />
      </DialogContent>
    </Dialog>
  );
}
