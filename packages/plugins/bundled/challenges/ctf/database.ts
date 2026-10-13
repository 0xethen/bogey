import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { browserClientFor } from "@bogey/db/browser";
import { ok, retryPolicy, toFailure, unwrap } from "@bogey/db/errors";

const hintSchema = z.object({
  ordinal: z.number(),
  cost: z.number(),
  content_md: z.string().nullable(),
});
export type Hint = z.infer<typeof hintSchema>;
const hintsSchema = z.array(hintSchema);

export type Challenge = {
  id: string;
  title: string;
  category: string;
  description_md: string;
  points: number;
  solves: number;
  solved: boolean;
  first_blood: string | null;
  hints: Hint[];
};

type ChallengeRow = Omit<Challenge, "hints"> & { hints: unknown };

export type ScoreRow = {
  rank: number;
  team_name: string;
  score: number;
  solves: number;
  first_bloods: number;
  last_solve_at: string;
};

export type FlagKind = "static" | "regex";

export type ChallengeInput = {
  title: string;
  category: string;
  description_md: string;
  scoring: "static" | "dynamic";
  points_initial: number;
  points_min: number;
  decay: number;
  visible: boolean;
  hints: { cost: number; content_md: string }[];
  flag_kind?: FlagKind;
  flag?: string;
  case_sensitive?: boolean;
};

export type CtfDatabase = {
  public: {
    Tables: { [_ in never]: never };
    Views: { [_ in never]: never };
    Functions: {
      ctf_challenges_for_team: { Args: { p_event: string }; Returns: ChallengeRow[] };
      ctf_submit_flag: { Args: { p_challenge: string; p_flag: string }; Returns: string };
      ctf_unlock_hint: { Args: { p_challenge: string; p_ordinal: number }; Returns: string };
      ctf_scoreboard: { Args: { p_event: string }; Returns: ScoreRow[] };
      ctf_save_challenge: {
        Args: { p_event: string; p_id?: string; p_data: ChallengeInput };
        Returns: string;
      };
      ctf_delete_challenge: { Args: { p_id: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export const client = () => browserClientFor<CtfDatabase>();

export const challengesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["ctf", "challenges", eventId] as const,
    queryFn: async (): Promise<Challenge[]> => {
      const { data, error } = await client().rpc("ctf_challenges_for_team", { p_event: eventId });
      if (error) return unwrap(toFailure(error, "loading challenges"));
      return unwrap(
        ok((data ?? []).map((row) => ({ ...row, hints: hintsSchema.parse(row.hints) }))),
      );
    },
    retry: retryPolicy,
  });

export const scoreboardQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["ctf", "scoreboard", eventId] as const,
    queryFn: async (): Promise<ScoreRow[]> => {
      const { data, error } = await client().rpc("ctf_scoreboard", { p_event: eventId });
      return unwrap(error ? toFailure(error, "loading the scoreboard") : ok(data ?? []));
    },
    refetchInterval: 30_000,
    retry: retryPolicy,
  });
