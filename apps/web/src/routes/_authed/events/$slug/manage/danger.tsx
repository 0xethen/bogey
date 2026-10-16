import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { eventDeletion } from "@bogey/config";
import { deleteEventFn, updateEventFn } from "@bogey/db/queries/manage";
import { requestFailure, unwrap } from "@bogey/db/errors";
import type { Tables } from "@bogey/db/types";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { useEventRefresh } from "#/lib/refresh.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

const deleteSchema = (t: T, slug: string) =>
  z.object({
    confirm: z
      .string()
      .trim()
      .refine((value) => value === slug, t("danger.deleteMismatch"))
      .meta({ label: t("danger.deleteLabel", { slug }), placeholder: slug }),
  });

export const Route = createFileRoute("/_authed/events/$slug/manage/danger")({
  staticData: {
    title: msg("danger.title"),
    settings: (t) => [
      searchSection(t("danger.unpublish"), {
        keywords: ["draft", "hide", "unpublish", "visibility"],
        id: "unpublish",
      }),
      searchSection(t("danger.delete"), { keywords: ["delete", "remove", "event"], id: "delete" }),
    ],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, access } = Route.useRouteContext();
  return (
    <Screen title={t("danger.title")} description={t("danger.intro")} width="embedded">
      <Unpublish event={event} />
      {eventDeletion && (
        <Screen.Section id="delete" title={t("danger.delete")} description={t("danger.deleteHelp")}>
          {access.orgAdmin ? (
            <DeleteEvent event={event} />
          ) : (
            <p className="text-sm text-muted-fg">{t("danger.deleteAdminsOnly")}</p>
          )}
        </Screen.Section>
      )}
    </Screen>
  );
}

function Unpublish({ event }: { event: Pick<Tables<"events">, "id" | "visibility"> }) {
  const t = useT();
  const refreshEvent = useEventRefresh(event.id);
  const unpublish = useMutation({
    mutationFn: async () =>
      unwrap(await updateEventFn({ data: { eventId: event.id, visibility: "draft" } })),
    onSuccess: refreshEvent,
  });
  const draft = event.visibility === "draft";
  return (
    <Screen.Section
      id="unpublish"
      title={t("danger.unpublish")}
      description={draft ? t("danger.unpublishDraft") : t("danger.unpublishHelp")}
    >
      {!draft && (
        <div className="flex flex-col gap-3">
          <div>
            <Button
              variant="destructive"
              disabled={unpublish.isPending}
              confirm={{
                title: t("danger.unpublishTitle"),
                description: t("danger.unpublishBody"),
                label: t("danger.unpublishConfirm"),
              }}
              onClick={() => unpublish.mutate()}
            >
              {t("danger.unpublishButton")}
            </Button>
          </div>
          <ErrorAlert error={unpublish.error} title={t("overview.visibilityFailed")} />
        </div>
      )}
    </Screen.Section>
  );
}

function DeleteEvent({ event }: { event: Pick<Tables<"events">, "id" | "slug" | "name"> }) {
  const t = useT();
  const schema = useMemo(() => deleteSchema(t, event.slug), [t, event.slug]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { confirm: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, createValidationError }) => {
      const result = await deleteEventFn({
        data: { eventId: event.id, confirm: value.confirm },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await navigate({ to: "/events", replace: true });
      queryClient.removeQueries({ queryKey: ["event"] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-3">
        <form.Field name="confirm">{(field) => <field.TextField autoComplete="off" />}</form.Field>
        <form.FormAlert title={t("danger.deleteFailed")} />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <div>
              <Button
                variant="destructive"
                disabled={submitting}
                confirm={{
                  title: t("danger.deleteTitle", { name: event.name }),
                  description: t("danger.deleteBody"),
                  label: t("danger.deleteConfirm"),
                }}
                onClick={() => void form.handleSubmit()}
              >
                {submitting ? t("danger.deleting") : t("danger.deleteButton")}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form.Form>
    </form.AppForm>
  );
}
