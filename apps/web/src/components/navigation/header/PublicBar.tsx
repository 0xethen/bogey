import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { brand } from "@bogey/config";
import { sessionQueryOptions } from "@bogey/db/auth";
import { useT } from "#/lib/translate.tsx";
import { Button } from "@bogey/ui/components/button";
import { cn } from "@bogey/ui/lib/utils";
import { ReportPage } from "#/components/report-page.tsx";

export function PublicBar({
  orgName,
  floating,
  signIn = true,
}: {
  orgName?: string;
  floating?: boolean;
  signIn?: boolean;
}) {
  const t = useT();
  const { data: session } = useQuery(sessionQueryOptions());
  const here = useLocation({ select: (location) => location.href });
  const signedIn = session?.status === "authenticated";

  return (
    <header
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-4 sm:px-6",
        floating && "absolute inset-x-0 top-0 z-10",
      )}
    >
      <Link to="/" className="flex min-w-0 items-center gap-2 font-medium">
        {brand.icons && <img src={brand.icons.default} alt="" className="size-6" />}
        <span className="truncate">{orgName ?? brand.name}</span>
      </Link>
      <div className="flex items-center gap-1">
        <ReportPage />
        {signedIn ? (
          <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/events" />}>
            {t("nav.yourEvents")}
          </Button>
        ) : (
          signIn && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/auth/login" search={{ redirect: here }} />}
            >
              {t("nav.signIn")}
            </Button>
          )
        )}
      </div>
    </header>
  );
}
