import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { FormEditor } from "./-components/form-editor.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions/forms/new")({
  staticData: { title: msg("manageForms.newTitle") },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const navigate = useNavigate();
  return (
    <Screen
      title={t("manageForms.newTitle")}
      description={t("manageForms.newIntro")}
      width="embedded"
    >
      <FormEditor
        form={null}
        onDone={() =>
          void navigate({
            to: "/events/$slug/manage/submissions/forms",
            params: { slug: event.slug },
          })
        }
      />
    </Screen>
  );
}
