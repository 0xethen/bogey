import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { browserClient } from "@bogey/db/browser";
import { unwrap } from "@bogey/db/errors";
import { settingsQueryOptions, updateSettings } from "@bogey/db/queries/settings";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FileDrop } from "@bogey/ui/components/file-drop";
import {
  GUIDE_BUCKET,
  GUIDE_MAX_MB,
  GuideViewer,
  guideFolder,
} from "#/components/event/judging/judge-guide.tsx";
import { useT } from "#/lib/translate.tsx";

/** Organizers upload one PDF that judges read beside each project. */
export function GuideUpload({ eventId }: { eventId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions({ eventId }, ["judging"]));
  const guide = settings.judging.guide;
  const storage = () => browserClient().storage.from(GUIDE_BUCKET);

  const replace = useMutation({
    mutationFn: async (file: File | null) => {
      let next = null;
      if (file) {
        if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
          throw new Error(t("judgeGuide.notPdf", { name: file.name }));
        }
        if (file.size > GUIDE_MAX_MB * 1024 * 1024) {
          throw new Error(t("onboarding.tooBig", { name: file.name, max: GUIDE_MAX_MB }));
        }
        const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
        const path = `${guideFolder(eventId)}/${crypto.randomUUID()}-${safe}`;
        const { error } = await storage().upload(path, file, { contentType: "application/pdf" });
        if (error) {
          throw new Error(t("onboarding.uploadFailed", { name: file.name, error: error.message }));
        }
        next = { path, name: file.name.slice(0, 200) };
      }
      unwrap(await updateSettings({ scope: "event", eventId }, "judging", { guide: next }));
      if (guide) await storage().remove([guide.path]);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <div className="flex flex-col gap-3">
      <FileDrop
        files={guide ? [{ id: guide.path, name: guide.name, sizeBytes: 0 }] : []}
        accept=".pdf"
        maxMb={GUIDE_MAX_MB}
        multiple={false}
        busy={replace.isPending}
        invalid={replace.isError}
        onAdd={(files) => {
          const [file] = files;
          if (file) replace.mutate(file);
        }}
        onRemove={() => replace.mutate(null)}
      />
      {replace.error && (
        <ErrorAlert title={t("judgeGuide.uploadFailed")} error={replace.error.message} />
      )}
      {guide && <GuideViewer guide={guide} className="h-[32rem]" />}
    </div>
  );
}
