import { IconArrowsSort, IconLayoutGrid, IconColumns3 } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";
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
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="outline" aria-label={t("gallery.sortBy")} />}
            />
          }
        >
          <IconArrowsSort />
        </TooltipTrigger>
        <TooltipContent>{t("gallery.sortBy")}</TooltipContent>
      </Tooltip>
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
        <Tooltip key={key}>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant={value === key ? "secondary" : "ghost"}
                aria-pressed={value === key}
                aria-label={t(label)}
                onClick={() => onChange(key)}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipContent>{t(label)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
