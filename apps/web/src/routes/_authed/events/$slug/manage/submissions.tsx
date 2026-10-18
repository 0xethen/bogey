import { exportHref } from "#/lib/exports.ts";
import { ProjectExport } from "#/components/event/project-export.tsx";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  cancelSubmissionDeletionFn,
  deleteSubmissionFn,
  eventSubmissionsQueryOptions,
  setDisqualifiedFn,
  submissionFormsQueryOptions,
  type TeamSubmission,
} from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { unwrap } from "@bogey/db/errors";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import { IconBan, IconFileText, IconForms, IconSend, IconDownload } from "@tabler/icons-react";
import { SubmissionAnswers } from "#/components/event/submission/submission-answers.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions")({
  staticData: {
    title: msg("window.submissions"),
    settings: (t) => [
      searchSection(t("manageSubs.deletion"), { id: "deletion-requests" }),
      searchSection(t("manageSubs.drafts"), { id: "drafts" }),
      searchSection(t("manageSubs.reminders"), { id: "reminders" }),
      ...searchSettings("submissions", ["reminderHours"], t),
      searchSection(t("manageSubs.disqualified"), { id: "disqualified" }),
    ],
  },
  validateSearch: z.object({ form: z.string().optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventSubmissionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(submissionFormsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "submissions",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const STATUS_LABEL = {
  draft: "manageSubs.draft",
  submitted: "overview.submitted",
  disqualified: "manageSubs.disqualified",
} as const satisfies Record<TeamSubmission["status"], PlainKey>;

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { form: selectedKey } = Route.useSearch();
  const queryClient = useQueryClient();
  const options = eventSubmissionsQueryOptions(event.id);
  const { data: all } = useSuspenseQuery(options);
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  useLiveInvalidate("submissions", options.queryKey, { filter: `event_id=eq.${event.id}` });

  const disqualify = useMutation({
    mutationFn: async (change: { id: string; disqualified: boolean }) =>
      unwrap(await setDisqualifiedFn({ data: change })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteSubmissionFn({ data: id })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });
  const decline = useMutation({
    mutationFn: async (id: string) => unwrap(await cancelSubmissionDeletionFn({ data: id })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });

  const form = forms.find((candidate) => candidate.key === selectedKey) ?? forms[0];
  const editForms = (
    <>
      {form && (
        <>
          <ProjectExport
            event={event}
            formKey={form.key}
            trigger={
              <Button size="sm" variant="outline">
                <IconDownload />
                {t("projectExport.button")}
              </Button>
            }
          />
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={exportHref(event.slug, "submission-files", form.key)} download />}
          >
            <IconDownload />
            {t("manageSubs.zip")}
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        nativeButton={false}
        render={<Link to="/events/$slug/manage/forms" params={{ slug: event.slug }} />}
      >
        <IconForms />
        {t("manageSubs.forms")}
      </Button>
    </>
  );

  if (!form) {
    return (
      <Screen title={t("window.submissions")} width="embedded" actions={editForms}>
        <p className="text-sm text-muted-fg">{t("manageSubs.noForm")}</p>
      </Screen>
    );
  }

  const submissions = all.filter((row) => row.form_id === form.id);
  const submitted = submissions.filter((row) => row.status === "submitted");
  const drafts = submissions.filter((row) => row.status === "draft");
  const disqualified = submissions.filter((row) => row.status === "disqualified");
  const deletionRequests = submissions.filter((row) => row.deletion_requested_at);
  const formWindow = windowByKey(windows, form.window_key);

  const row = (submission: TeamSubmission) => (
    <DisclosureRow
      key={submission.id}
      leading={
        <StatusDot
          tone={
            submission.status === "submitted"
              ? "done"
              : submission.status === "disqualified"
                ? "attention"
                : "idle"
          }
          label={t(STATUS_LABEL[submission.status])}
        />
      }
      title={submission.title || t("judging.untitled")}
      meta={
        <>
          {submission.teamName}
          {submission.status === "submitted" && submission.submitted_at && (
            <>
              , {t("manageSubs.submittedAgo")} <RelativeTime value={submission.submitted_at} />
            </>
          )}
          {submission.status === "draft" && (
            <>
              , {t("manageSubs.editedAgo")} <RelativeTime value={submission.updated_at} />
            </>
          )}
          {submission.deletion_requested_at && `, ${t("manageSubs.deletionRequested")}`}
        </>
      }
    >
      <div className="flex flex-col gap-4 pl-5">
        <SubmissionAnswers form={form} submission={submission} files={submission.files} />
        <div className="flex flex-wrap gap-2">
          {submission.status === "disqualified" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disqualify.isPending}
              onClick={() => disqualify.mutate({ id: submission.id, disqualified: false })}
            >
              {t("manageSubs.reinstate")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={disqualify.isPending}
              confirm={{
                title: t("manageSubs.disqualifyTitle", {
                  name: submission.title || t("manageSubs.thisSubmission"),
                }),
                description: t("manageSubs.disqualifyBody", { team: submission.teamName }),
                label: t("manageSubs.disqualify"),
              }}
              onClick={() => disqualify.mutate({ id: submission.id, disqualified: true })}
            >
              {t("manageSubs.disqualifyButton")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={remove.isPending}
            confirm={{
              title: t("manageSubs.deleteTitle", {
                name: submission.title || t("manageSubs.thisSubmission"),
              }),
              description: t("manageSubs.deleteBody", { team: submission.teamName }),
              label: t("common.delete"),
            }}
            onClick={() => remove.mutate(submission.id)}
          >
            {submission.deletion_requested_at ? t("manageSubs.deleteAsked") : t("webhooks.delete")}
          </Button>
          {submission.deletion_requested_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={decline.isPending}
              onClick={() => decline.mutate(submission.id)}
            >
              {t("manageSubs.decline")}
            </Button>
          )}
        </div>
      </div>
    </DisclosureRow>
  );

  return (
    <Screen
      title={t("window.submissions")}
      description={
        !formWindow ? (
          <Linked
            text={t("manageSubs.noWindow", { form: form.title, agenda: LINK })}
            links={[
              <SettingLink key="agenda" to={`/events/${event.slug}/manage/agenda`} hash="windows">
                {t("path.agenda")}
              </SettingLink>,
            ]}
          />
        ) : isWindowOpen(formWindow) ? (
          t("manageSubs.isOpen", { form: form.title })
        ) : (
          <>
            {t("manageSubs.isClosed", { form: form.title })}{" "}
            <Route.Link
              to="/events/$slug/manage/agenda"
              params={{ slug: event.slug }}
              className="link"
            >
              {t("manageSubs.openIt")}
            </Route.Link>
          </>
        )
      }
      width="embedded"
      actions={editForms}
    >
      {forms.length > 1 && (
        <nav aria-label={t("manageSubs.formsNav")} className="-mx-1 flex gap-1 overflow-x-auto">
          {forms.map((candidate) => (
            <Link
              key={candidate.id}
              to="/events/$slug/manage/submissions"
              params={{ slug: event.slug }}
              search={{ form: candidate.key }}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm no-underline",
                candidate.id === form.id
                  ? "bg-muted font-medium text-fg"
                  : "text-muted-fg hocus:bg-muted hocus:text-fg",
              )}
            >
              {candidate.title}
              <span className="ml-1.5 text-muted-fg tabular-nums">
                {
                  all.filter((item) => item.form_id === candidate.id && item.status === "submitted")
                    .length
                }
              </span>
            </Link>
          ))}
        </nav>
      )}

      <StatGroup>
        <Stat icon={IconSend} label={t("overview.submitted")} value={submitted.length} />
        <Stat icon={IconFileText} label={t("manageSubs.drafts")} value={drafts.length} />
        <Stat icon={IconBan} label={t("manageSubs.disqualified")} value={disqualified.length} />
      </StatGroup>

      <ErrorAlert
        error={disqualify.error ?? remove.error ?? decline.error}
        title={t("manageSubs.changeFailed")}
      />

      {deletionRequests.length > 0 && (
        <Screen.Section
          id="deletion-requests"
          title={t("manageSubs.deletion")}
          description={t("manageSubs.deletionHelp")}
        >
          <DisclosureList>{deletionRequests.map(row)}</DisclosureList>
        </Screen.Section>
      )}

      <Screen.Section id="submitted" title={t("overview.submitted")}>
        {submitted.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("manageSubs.nothing")}</p>
        ) : (
          <DisclosureList>{submitted.map(row)}</DisclosureList>
        )}
      </Screen.Section>
      {drafts.length > 0 && (
        <Screen.Section
          id="drafts"
          title={t("manageSubs.drafts")}
          description={t("manageSubs.draftsHelp")}
        >
          <DisclosureList>{drafts.map(row)}</DisclosureList>
        </Screen.Section>
      )}
      <Screen.Section id="reminders" title={t("manageSubs.reminders")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="submissions"
          keys={["reminderHours"]}
        />
      </Screen.Section>
      {disqualified.length > 0 && (
        <Screen.Section
          id="disqualified"
          title={t("manageSubs.disqualified")}
          description={t("manageSubs.disqualifiedHelp")}
        >
          <DisclosureList>{disqualified.map(row)}</DisclosureList>
        </Screen.Section>
      )}
      <PluginSettingSections page="submissions" />
    </Screen>
  );
}
