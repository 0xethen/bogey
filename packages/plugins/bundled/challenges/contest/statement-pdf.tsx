import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconDownload } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { statementPdfQueryOptions } from "../db.ts";

export function StatementPdf({ path, title }: { path: string; title: string }) {
  const pdf = useQuery(statementPdfQueryOptions(path));
  const url = useMemo(() => (pdf.data ? URL.createObjectURL(pdf.data) : null), [pdf.data]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  if (pdf.isError) {
    return (
      <ErrorAlert
        error={pdf.error instanceof Error ? pdf.error : null}
        title="Couldn't open the statement"
      />
    );
  }
  if (!url) return <Skeleton className="h-[70vh] w-full" />;
  return (
    <div className="flex flex-col gap-2">
      <object
        data={url}
        type="application/pdf"
        title={title}
        className="h-[75vh] w-full rounded-2xl border border-border"
      >
        <p className="p-4 text-sm text-muted-fg">
          This browser can't show the PDF here. Download it instead.
        </p>
      </object>
      <div>
        <Button
          size="sm"
          variant="outline"
          render={<a href={url} download={`${title}.pdf`} />}
          nativeButton={false}
        >
          <IconDownload />
          Download the statement
        </Button>
      </div>
    </div>
  );
}
