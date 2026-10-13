import type { ReactNode } from "react";
import { cn } from "@bogey/ui/lib/utils";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { useT } from "#/lib/translate.tsx";

export interface RosterMember {
  key: string;
  name: string;
  note?: string;
  badge?: ReactNode;
}

export function Roster({
  members,
  capacity,
  openSeat,
}: {
  members: Tuple<RosterMember>;
  capacity: number;
  openSeat?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        <div
          role="meter"
          aria-label={t("roster.seatsFilled")}
          aria-valuemin={0}
          aria-valuemax={capacity}
          aria-valuenow={members.length}
          className="flex h-1.5 flex-1 gap-1"
        >
          {Array.from({ length: capacity }, (_, index) => (
            <span
              key={index}
              className={cn(
                "flex-1 rounded-pill",
                index < members.length ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <span className="shrink-0 text-muted-fg tabular-nums">
          {t("roster.seats", { count: members.length, capacity })}
        </span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {members.map((member) => (
          <li
            key={member.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <NameAvatar name={member.name} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {member.name}
              {member.note && <span className="font-normal text-muted-fg"> {member.note}</span>}
            </span>
            {member.badge}
          </li>
        ))}
      </ul>

      {openSeat && (
        <div className="flex min-h-13 items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-fg">
          {openSeat}
        </div>
      )}
    </div>
  );
}
