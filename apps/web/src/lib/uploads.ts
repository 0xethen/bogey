import { useQuery } from "@tanstack/react-query";
import { uploadLimitQueryOptions } from "@bogey/db/queries/uploads";

export function useUploadMb(eventId: string, ownMb: number): number {
  const { data: cap } = useQuery(uploadLimitQueryOptions(eventId));
  return cap ? Math.min(ownMb, cap) : ownMb;
}
