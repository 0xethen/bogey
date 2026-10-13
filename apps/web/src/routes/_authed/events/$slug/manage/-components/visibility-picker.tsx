import { useMutation } from "@tanstack/react-query";
import { updateEventFn } from "@bogey/db/queries/manage";
import { unwrap } from "@bogey/db/errors";
import type { Enums, Tables } from "@bogey/db/types";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { useEventRefresh } from "#/lib/refresh.ts";
import { useT, type PlainKey } from "#/lib/translate.tsx";

type Visibility = Enums<"event_visibility">;

const VISIBILITY: Tuple<{ value: Visibility; label: PlainKey; description: PlainKey }> = [
  { value: "draft", label: "visibility.draft", description: "visibility.draftHelp" },
  { value: "unlisted", label: "visibility.unlisted", description: "visibility.unlistedHelp" },
  { value: "public", label: "visibility.public", description: "visibility.publicHelp" },
];

export function VisibilityPicker({
  event,
}: {
  event: Pick<Tables<"events">, "id" | "visibility">;
}) {
  const t = useT();
  const refreshEvent = useEventRefresh(event.id);
  const setVisibility = useMutation({
    mutationFn: async (visibility: Visibility) =>
      unwrap(await updateEventFn({ data: { eventId: event.id, visibility } })),
    onSuccess: refreshEvent,
  });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <OptSelect
          ariaLabel={t("overview.visibility")}
          value={event.visibility}
          options={VISIBILITY.map((each) => ({
            ...each,
            label: t(each.label),
            description: t(each.description),
          }))}
          disabled={setVisibility.isPending}
          onChange={(visibility) => setVisibility.mutate(visibility)}
        />
      </div>
      <ErrorAlert error={setVisibility.error} title={t("overview.visibilityFailed")} />
    </div>
  );
}
