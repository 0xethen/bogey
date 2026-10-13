import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { browserClient } from "@bogey/db/browser";
import type {
  Submission,
  SubmissionFile,
  SubmissionForm,
  SubmissionItem,
} from "@bogey/db/queries/submissions";
import type { Json } from "@bogey/db/types";
import { Button } from "@bogey/ui/components/button";
import { Markdown } from "@bogey/ui/components/markdown";
import { pluginItemType } from "@bogey/plugins";
import { isPluginAnswerKind } from "@bogey/utils/answers";
import { pluginItemInfo } from "./submission-item-field.tsx";
import { IconDownload, IconEye } from "@tabler/icons-react";
import { useT } from "#/lib/translate.tsx";

export function SubmissionAnswers({
  form,
  submission,
  files,
  blind,
}: {
  form: SubmissionForm;
  submission: Submission;
  files: Tuple<SubmissionFile>;
  blind?: boolean;
}) {
  const t = useT();
  const answers =
    submission.answers &&
    typeof submission.answers === "object" &&
    !Array.isArray(submission.answers)
      ? submission.answers
      : {};

  return (
    <dl className="flex flex-col gap-4 text-sm">
      {form.items.map((item) => {
        const value = answers[item.key];
        const itemFiles = files.filter((file) => file.item_key === item.key);
        const empty =
          item.kind === "file" ? itemFiles.length === 0 : value === undefined || value === "";
        return (
          <div key={item.key} className="flex flex-col gap-1">
            <dt className="text-muted-fg">{item.label}</dt>
            <dd className="min-w-0">
              <Hidden when={!empty && !!blind && !!item.namesPeople}>
                {empty ? (
                  <span className="text-muted-fg">{t("submission.notAnswered")}</span>
                ) : item.kind === "file" ? (
                  <ul className="flex flex-col gap-1">
                    {itemFiles.map((file) => (
                      <li key={file.id}>
                        <FileLink file={file} />
                      </li>
                    ))}
                  </ul>
                ) : isPluginAnswerKind(item.kind) ? (
                  <PluginAnswer item={item} value={value} />
                ) : item.kind === "markdown" || item.kind === "longtext" ? (
                  <Markdown>{String(value)}</Markdown>
                ) : item.kind === "url" || item.kind === "video" || item.kind === "drive" ? (
                  <a
                    href={String(value)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="link break-all"
                  >
                    {String(value)}
                  </a>
                ) : item.kind === "boolean" ? (
                  value === true ? (
                    t("common.yes")
                  ) : (
                    t("common.no")
                  )
                ) : (
                  String(value)
                )}
              </Hidden>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function PluginAnswer({ item, value }: { item: SubmissionItem; value: Json | undefined }) {
  const View = pluginItemType(item.kind)?.View;
  const answer = typeof value === "boolean" ? value : String(value ?? "");
  if (!View) return <span className="whitespace-pre-wrap">{String(answer)}</span>;
  return <View item={pluginItemInfo(item)} value={answer} />;
}

function FileLink({ file }: { file: SubmissionFile }) {
  const open = useMutation({
    mutationFn: async () => {
      const { data, error } = await browserClient()
        .storage.from("submissions")
        .createSignedUrl(file.storage_path, 60, { download: file.file_name });
      if (error) throw error;
      window.location.assign(data.signedUrl);
    },
  });
  return (
    <Button
      type="button"
      variant="link"
      className="h-auto gap-1.5 p-0"
      disabled={open.isPending}
      onClick={() => open.mutate()}
    >
      <IconDownload className="size-3.5" />
      {file.file_name}
    </Button>
  );
}

function Hidden({ when, children }: { when: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const t = useT();
  if (!when || shown) return children;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-3">
      <span className="flex-1 text-muted-fg">{t("submission.mayName")}</span>
      <Button type="button" size="sm" variant="outline" onClick={() => setShown(true)}>
        <IconEye />
        {t("submission.showAnswer")}
      </Button>
    </div>
  );
}
