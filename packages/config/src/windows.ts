export interface CoreWindow {
  key: string;
  label: string;
  opens: string;
}

export const CORE_WINDOW_INFO: Tuple<CoreWindow> = [
  { key: "registration", label: "Registration", opens: "People can register for the event" },
  {
    key: "checkin",
    label: "Check-in",
    opens: "Staff check people in, and people check themselves in with the venue code",
  },
  { key: "teams", label: "Team changes", opens: "Participants create, join and leave teams" },
  {
    key: "instructions",
    label: "Instructions",
    opens: "Pages and sections held back until then become visible",
  },
  {
    key: "sessions",
    label: "Session sign-ups",
    opens: "Participants sign up for the agenda's sessions",
  },
  {
    key: "submissions",
    label: "Submissions",
    opens: "Teams edit and submit their projects (each form can have its own, `submit-<form>`)",
  },
  { key: "judging", label: "Judging", opens: "Judges score, and rounds can advance" },
  { key: "voting", label: "Popular vote", opens: "Eligible people vote for projects" },
  {
    key: "results",
    label: "Results",
    opens: "Published results and awards are visible to participants",
  },
  {
    key: "gallery",
    label: "Project gallery",
    opens: "Shared projects are visible on the public gallery",
  },
];
