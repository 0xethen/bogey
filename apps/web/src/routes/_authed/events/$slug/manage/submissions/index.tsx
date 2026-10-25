import { exportHref } from "#/lib/exports.ts";
import { ProjectExport } from "#/components/event/project-export.tsx";
import { useCallback, useMemo } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type UseMutationResult,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  cancelSubmissionDeletionFn,
  deleteSubmissionFn,
  eventSubmissionsQueryOptions,
  setDisqualifiedFn,
  submissionFormsQueryOptions,
  type SubmissionForm,
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
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
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
import { RefreshButton } from "#/components/app/refresh-button.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions/")({
  // Old #gallery links, from before the gallery had its own subtab.
  beforeLoad: ({ params, location }) => {
    if (location.hash === "gallery") {
      throw redirect({
        to: "/events/$slug/manage/submissions/gallery",
        params,
        replace: true,
      });
    }
  },
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
      context.query.query({
        ...eventSubmissionsQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({
        ...submissionFormsQueryOptions(context.event.id),
        staleTime: "static",
      }),
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
      <RefreshButton queryKeys={[options.queryKey]} />
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
            render={<a href={exportHref(event.slug, "submission-files", form.key)} download />}
            nativeButton={false}
          >
            <IconDownload />
            {t("manageSubs.zip")}
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant="outline"
        render={<Link to="/events/$slug/manage/submissions/forms" params={{ slug: event.slug }} />}
        nativeButton={false}
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

  const actions = { disqualify, remove, decline };

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
              {t("manageSubs.openIt")}...
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
          <SubmissionTable rows={deletionRequests} form={form} actions={actions} />
        </Screen.Section>
      )}

      <Screen.Section id="submitted" title={t("overview.submitted")}>
        {submitted.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("manageSubs.nothing")}</p>
        ) : (
          <SubmissionTable rows={submitted} form={form} actions={actions} />
        )}
      </Screen.Section>
      {drafts.length > 0 && (
        <Screen.Section
          id="drafts"
          title={t("manageSubs.drafts")}
          description={t("manageSubs.draftsHelp")}
        >
          <SubmissionTable rows={drafts} form={form} actions={actions} />
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
          <SubmissionTable rows={disqualified} form={form} actions={actions} />
        </Screen.Section>
      )}
      <PluginSettingSections page="submissions" />
    </Screen>
  );
}

interface Actions {
  disqualify: UseMutationResult<unknown, Error, { id: string; disqualified: boolean }>;
  remove: UseMutationResult<unknown, Error, string>;
  decline: UseMutationResult<unknown, Error, string>;
}

const column = dataColumns<TeamSubmission>();

function submissionText(submission: TeamSubmission, untitled: string): string {
  return `${submission.title || untitled} ${submission.teamName}`;
}

function SubmissionTable({
  rows,
  form,
  actions,
}: {
  rows: TeamSubmission[];
  form: SubmissionForm;
  actions: Actions;
}) {
  const t = useT();
  const { disqualify, remove, decline } = actions;
  const busy = {
    disqualify: disqualify.isPending,
    remove: remove.isPending,
    decline: decline.isPending,
  };
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor((submission) => submission.title || t("judging.untitled"), {
          id: "title",
          header: t("tables.project"),
          enableHiding: false,
          cell: (info) => {
            const submission = info.row.original;
            return (
              <span className="flex items-center gap-2 font-medium">
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
                {info.getValue()}
              </span>
            );
          },
        }),
        column.accessor("teamName", { header: t("tables.team") }),
        column.accessor(
          (submission) =>
            (submission.status === "draft" ? submission.updated_at : submission.submitted_at) ?? "",
          {
            id: "when",
            header: t("facts.when"),
            cell: (info) => {
              const submission = info.row.original;
              const value = info.getValue();
              return (
                <span className="text-muted-fg">
                  {value && (
                    <>
                      {submission.status === "draft"
                        ? t("manageSubs.editedAgo")
                        : t("manageSubs.submittedAgo")}{" "}
                      <RelativeTime value={value} />
                    </>
                  )}
                  {submission.deletion_requested_at && (
                    <span className="block text-xs">{t("manageSubs.deletionRequested")}</span>
                  )}
                </span>
              );
            },
          },
        ),
      ]),
    [t],
  );
  const search = useMemo(
    () => ({
      text: (submission: TeamSubmission) => submissionText(submission, t("judging.untitled")),
    }),
    [t],
  );
  const detail = useCallback(
    (submission: TeamSubmission) => (
      <div className="flex flex-col gap-4 py-2">
        <SubmissionAnswers form={form} submission={submission} files={submission.files} />
        <div className="flex flex-wrap gap-2">
          {submission.status === "disqualified" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy.disqualify}
              onClick={() => disqualify.mutate({ id: submission.id, disqualified: false })}
            >
              {t("manageSubs.reinstate")}
            </Button>
          ) : (
            <Button
              variant="ghost-destructive"
              size="sm"
              disabled={busy.disqualify}
              confirm={{
                title: t("manageSubs.disqualifyTitle", {
                  name: submission.title || t("manageSubs.thisSubmission"),
                }),
                description: t("manageSubs.disqualifyBody", { team: submission.teamName }),
                label: t("manageSubs.disqualify"),
              }}
              onClick={() => disqualify.mutate({ id: submission.id, disqualified: true })}
            >
              {t("manageSubs.disqualifyButton")}...
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={busy.remove}
            confirm={{
              title: t("manageSubs.deleteTitle", {
                name: submission.title || t("manageSubs.thisSubmission"),
              }),
              description: t("manageSubs.deleteBody", { team: submission.teamName }),
              label: t("common.delete"),
            }}
            onClick={() => remove.mutate(submission.id)}
          >
            {submission.deletion_requested_at
              ? `${t("manageSubs.deleteAsked")}...`
              : `${t("webhooks.delete")}...`}
          </Button>
          {submission.deletion_requested_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy.decline}
              onClick={() => decline.mutate(submission.id)}
            >
              {t("manageSubs.decline")}
            </Button>
          )}
        </div>
      </div>
    ),
    // the mutations are new objects each render; their pending flags are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, t, busy.disqualify, busy.remove, busy.decline],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(submission) => submission.id}
      search={search}
      detail={detail}
      pageSize={25}
    />
  );
}
