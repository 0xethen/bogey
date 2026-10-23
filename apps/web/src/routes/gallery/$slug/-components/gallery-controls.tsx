import { IconArrowsSort, IconLayoutGrid, IconColumns3 } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import { GALLERY_SORTS, type GalleryLayout, type GallerySort } from "#/lib/gallery.ts";
import { useT } from "#/lib/translate.tsx";

/** An icon that opens the sort orders; the one in force is checked. */
export function SortMenu({
  value,
  options,
  onChange,
}: {
  value: GallerySort;
  options: Tuple<GallerySort>;
  onChange: (sort: GallerySort) => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t("gallery.sortBy")}
            tooltip={t("gallery.sortBy")}
          />
        }
      >
        <IconArrowsSort />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const sort = GALLERY_SORTS.find((each) => each.key === next);
            if (sort) onChange(sort.key);
          }}
        >
          {GALLERY_SORTS.filter((sort) => options.includes(sort.key)).map((sort) => (
            <DropdownMenuRadioItem key={sort.key} value={sort.key}>
              {t(sort.label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LAYOUTS = [
  { key: "grid", label: "gallery.layoutGrid", icon: IconLayoutGrid },
  { key: "lanes", label: "gallery.layoutLanes", icon: IconColumns3 },
] as const;

export function LayoutToggle({
  value,
  onChange,
}: {
  value: GalleryLayout;
  onChange: (layout: GalleryLayout) => void;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={t("gallery.layout")} className="flex gap-0.5">
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          size="icon-sm"
          variant={value === key ? "secondary" : "ghost"}
          aria-pressed={value === key}
          aria-label={t(label)}
          tooltip={t(label)}
          onClick={() => onChange(key)}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}
