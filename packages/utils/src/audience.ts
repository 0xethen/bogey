/** Who a registration question or submission item is for. Both empty means everyone. */
export interface Audience {
  divisionIds?: Tuple<string>;
  tagIds?: Tuple<string>;
}

/** Someone's division, and the tags they (or their team's members) hold. */
export interface Member {
  divisionId: string | null;
  tagIds: Tuple<string>;
}

export function hasAudience(audience: Audience): boolean {
  return !!audience.divisionIds?.length || !!audience.tagIds?.length;
}

/** Mirrors private.audience_reaches: one matching division or tag is enough. */
export function audienceReaches(audience: Audience, member: Member): boolean {
  if (!hasAudience(audience)) return true;
  return (
    (!!member.divisionId && !!audience.divisionIds?.includes(member.divisionId)) ||
    member.tagIds.some((tag) => audience.tagIds?.includes(tag))
  );
}
