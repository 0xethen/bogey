import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { createOrgFn, orgSlugTakenFn } from "@bogey/db/queries/instance";
import { requestFailure } from "@bogey/db/errors";
import { SLUG, toSlug } from "@bogey/utils/keys";
import { Button } from "@bogey/ui/components/button";
import { FieldGroup } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  remoteCheck,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { hostnameSchema } from "./-components/hostname.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/orgs/new")({
  staticData: { title: msg("adminOrgs.new") },
  component: RouteComponent,
});

const slugSchema = (t: T) =>
  z
    .string()
    .max(40, t("form.maxLength", { max: 40 }))
    .regex(SLUG, t("adminOrgs.slugRule"));

const orgSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("adminOrgs.needName"))
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("checkin.name") }),
    slug: slugSchema(t)
      .meta({ label: t("adminOrgs.address") })
      .describe(t("adminOrgs.addressHelp")),
    hostname: z
      .union([z.literal(""), hostnameSchema(t)])
      .meta({ label: t("adminOrgs.hostname"), placeholder: "acme.example.com" })
      .describe(t("adminOrgs.hostnameHelp")),
    ownerEmail: z
      .union([z.literal(""), z.email(t("adminOrgs.notEmail"))])
      .meta({ label: t("adminOrgs.owner"), placeholder: "organizer@example.com" })
      .describe(t("adminOrgs.ownerHelp")),
  });

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => orgSchema(t), [t]);
  const slug = useMemo(() => slugSchema(t), [t]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { name: "", slug: "", hostname: "", ownerEmail: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await createOrgFn({ data: value }).catch(requestFailure);
      if (!result.ok) {
        if (result.error.code === "not_found") {
          return createValidationError({ fields: { ownerEmail: result.error.message } });
        }
        return createValidationError(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      await navigate({ to: "/admin/orgs" });
      return undefined;
    },
  });

  return (
    <Screen title={t("adminOrgs.new")} description={t("adminOrgs.newIntro")} width="narrow">
      <form.AppForm>
        <form.Form unsaved="draft">
          <FieldGroup>
            <form.Field name="name">{(field) => <field.TextField required />}</form.Field>
            <form.Field
              name="slug"
              listeners={[
                {
                  triggers: ["change"],
                  watchFields: ["name"],
                  run: ({ value, fieldApi, formApi }) => {
                    if (fieldApi.meta.isTouched) return;
                    const linked = toSlug(formApi.getFieldValue("name"), 40);
                    if (linked !== value) fieldApi.handleChange(linked, { markAsTouched: false });
                  },
                },
              ]}
              validators={[
                rewardEarlyPunishLate(slug),
                {
                  ...remoteCheck,
                  run: async ({ value }) => {
                    const taken = await orgSlugTakenFn({ data: value }).catch(requestFailure);
                    return taken.ok && taken.data ? t("adminOrgs.slugTaken") : undefined;
                  },
                },
              ]}
            >
              {(field) => <field.SlugField required maxLength={40} />}
            </form.Field>
            <form.Field name="hostname">{(field) => <field.TextField />}</form.Field>
            <form.Field name="ownerEmail">{(field) => <field.TextField type="email" />}</form.Field>
            <form.FormAlert title={t("adminOrgs.createFailed")} />
            <div className="flex gap-2">
              <form.Submit pending={`${t("teamForm.creating")}...`}>
                {t("adminOrgs.create")}
              </form.Submit>
              <Button variant="ghost" render={<Link to="/admin/orgs" />} nativeButton={false}>
                {t("common.cancel")}
              </Button>
            </div>
          </FieldGroup>
        </form.Form>
      </form.AppForm>
    </Screen>
  );
}
