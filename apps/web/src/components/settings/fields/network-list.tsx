import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestFailure, type DbResult } from "@bogey/db/errors";
import { collapseRanges } from "@bogey/utils/network";
import { ASN, resolveAsnFn } from "#/lib/asn.ts";
import { networkAddress } from "@bogey/config/settings";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

function lines(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function networkListSchema(asn: boolean, t: T) {
  return z.string().superRefine((text, ctx) => {
    const bad = lines(text).find(
      (line) => !networkAddress.safeParse(line).success && !(asn && ASN.test(line)),
    );
    if (bad) ctx.addIssue({ code: "custom", message: t("network.notAddress", { value: bad }) });
  });
}

export async function expandNetworkList(text: string): Promise<DbResult<string[]>> {
  const list = lines(text);
  const out: string[] = [];
  for (const line of list) {
    if (!ASN.test(line)) {
      out.push(line);
      continue;
    }
    const result = await resolveAsnFn({ data: line }).catch(requestFailure);
    if (!result.ok) return result;
    out.push(...result.data);
  }
  return { ok: true, data: list.some((line) => ASN.test(line)) ? collapseRanges(out) : out };
}

export function NetworkListForm({
  saved,
  onSave,
  label,
  description,
  placeholder,
  hint,
  asn = false,
}: {
  saved: Tuple<string> | undefined;
  onSave: (networks: string[] | null) => Promise<DbResult<null>>;
  label: string;
  description: string;
  placeholder?: string;
  hint?: ReactNode;
  asn?: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { networks: (saved ?? []).join("\n") },
      errorVisibility,
      validators: [
        rewardEarlyPunishLate(
          z.object({
            networks: networkListSchema(asn, t).meta({ label, placeholder }).describe(description),
          }),
        ),
      ],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const expanded = await expandNetworkList(value.networks);
      if (!expanded.ok)
        return createValidationError({ fields: { networks: expanded.error.message } });
      const list = expanded.data;
      const result = await onSave(list.length ? list : null);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset({ networks: list.join("\n") });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-3">
        <form.Field name="networks">{(field) => <field.NetworkListField />}</form.Field>
        {hint && <p className="text-sm text-muted-fg">{hint}</p>}
        <form.FormAlert title={t("network.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}
