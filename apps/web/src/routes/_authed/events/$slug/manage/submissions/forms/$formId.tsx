import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { tagsQueryOptions } from "@bogey/db/queries/tags";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { FormEditor } from "./-components/form-editor.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions/forms/$formId")({
  staticData: { title: msg("manageForms.editTitle"), command: false },
  loader: async ({ context, params }) => {
    const [forms] = await Promise.all([
      context.query.query({
        ...submissionFormsQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...eventWindowsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventDivisionsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...tagsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }),
        staleTime: "static",
      }),
    ]);
    const form = forms.find((each) => each.id === params.formId);
    if (!form) throw notFound();
    return { title: form.title };
  },
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { formId } = Route.useParams();
  const navigate = useNavigate();
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const form = forms.find((each) => each.id === formId);
  const back = () =>
    navigate({ to: "/events/$slug/manage/submissions/forms", params: { slug: event.slug } });

  if (!form) return null;
  return (
    <Screen title={form.title} description={t("manageForms.editIntro")} width="embedded">
      <FormEditor key={form.id} form={form} onDeleted={back} />
    </Screen>
  );
}
