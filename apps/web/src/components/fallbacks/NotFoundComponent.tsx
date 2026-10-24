import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { useT } from "#/lib/translate.tsx";
import { FallbackMessage } from "./FallbackMessage.tsx";

export function NotFoundComponent() {
  const t = useT();
  const router = useRouter();
  const canGoBack = useCanGoBack();

  return (
    <Screen.Fallback
      icon={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-5"
        >
          <path d="M15 20l-6 -3l-6 3v-13l6 -3l6 3l6 -3v7.5" />
          <path d="M9 4v13" />
          <path d="M15 7v5.5" />
          <path d="M19 22v.01" />
          <path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
        </svg>
      }
      title={t("notFound.title")}
      description={t("notFound.body")}
    >
      <FallbackMessage />
      <Screen.Actions>
        <Button render={<a href="/" />} nativeButton={false}>
          {t("notFound.home")}
        </Button>
        {canGoBack && (
          <Button variant="outline" onClick={() => router.history.back()}>
            {t("notFound.back")}
          </Button>
        )}
      </Screen.Actions>
    </Screen.Fallback>
  );
}
