import { useRoleLabel } from "#/lib/roles.ts";
import { useNavigate } from "@tanstack/react-router";
import { setViewAs, useViewAs, VIEW_AS_ROLES } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { useT } from "#/lib/translate.tsx";
import { useRealEventAccess } from "#/lib/viewer.ts";

export function PreviewBar() {
  const previewing = useViewAs();
  const real = useRealEventAccess();
  const navigate = useNavigate();
  const t = useT();
  const roleLabel = useRoleLabel();
  if (!previewing) return null;
  const slug = real?.event.slug;

  return (
    <div className="flex h-(--previewbar-height) items-center justify-center gap-2 bg-warning px-3 text-sm font-medium text-background">
      <span className="shrink-0">{t("nav.viewingAs")}</span>
      <OptSelect
        size="sm"
        variant="muted"
        ariaLabel={t("nav.previewRole")}
        className="w-36"
        value={previewing}
        options={VIEW_AS_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
        onChange={(role) => setViewAs(role)}
      />
      <Button
        size="xs"
        variant="secondary"
        className="shrink-0"
        onClick={() => {
          setViewAs(null);
          if (slug) void navigate({ to: "/events/$slug/manage", params: { slug } });
        }}
      >
        {t("nav.stopPreviewing")}
      </Button>
    </div>
  );
}
