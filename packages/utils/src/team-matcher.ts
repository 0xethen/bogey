export interface Person {
  id: string;
  name: string;
  skills: readonly string[];
  interests: readonly string[];
  timezone: string | null;
  division: string | null;
}

export interface OpenTeam {
  id: string;
  name: string;
  members: number;
  skills: readonly string[];
  division: string | null;
  locked: boolean;
}

export interface Group {
  team: string | null;
  name: string | null;
  members: string[];
}

export interface Proposal {
  groups: Group[];
  unmatched: string[];
}

export interface Sizes {
  min: number;
  max: number;
  target: number;
}

export function parseLabels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((label) => label.trim().toLowerCase().slice(0, 30))
        .filter((label) => label !== ""),
    ),
  ].slice(0, 12);
}

export function joinLabels(labels: readonly string[]): string {
  return labels.join(", ");
}

export function utcOffsetHours(timezone: string | null): number | null {
  if (!timezone) return null;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(Date.UTC(2026, 0, 15)))
      .find((piece) => piece.type === "timeZoneName")?.value;
    if (part === undefined) return null;
    if (part === "GMT") return 0;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
    if (!match) return null;
    const hours = Number(match[2]) + Number(match[3]) / 60;
    return match[1] === "-" ? -hours : hours;
  } catch {
    return null;
  }
}

interface Slot {
  group: Group;
  capacity: number;
  skills: Set<string>;
  interests: Set<string>;
  offsets: number[];
  division: string | null;
}

function fits(slot: Slot, person: Person): boolean {
  return slot.group.members.length < slot.capacity && slot.division === person.division;
}

function fitScore(slot: Slot, person: Person): number {
  const newSkills = person.skills.filter((skill) => !slot.skills.has(skill)).length;
  const shared = person.interests.filter((interest) => slot.interests.has(interest)).length;
  const own = utcOffsetHours(person.timezone);
  let zone = 0;
  if (own !== null && slot.offsets.length > 0) {
    const mean = slot.offsets.reduce((sum, offset) => sum + offset, 0) / slot.offsets.length;
    zone = Math.min(Math.abs(own - mean), 12) / 6;
  }
  return 3 * newSkills + shared - zone - 0.5 * slot.group.members.length;
}

export function propose(
  people: readonly Person[],
  teams: readonly OpenTeam[],
  sizes: Sizes,
  newTeamName: (number: number) => string = (number) => `Team ${number}`,
): Proposal {
  const max = Math.max(sizes.max, 1);
  const min = Math.min(Math.max(sizes.min, 1), max);
  const target = Math.min(Math.max(sizes.target, min), max);

  const slots: Slot[] = teams
    .filter((team) => !team.locked && team.members < max)
    .sort((a, b) => a.members - b.members || a.name.localeCompare(b.name))
    .map((team) => ({
      group: { team: team.id, name: null, members: [] },
      capacity: Math.max(Math.min(max, Math.max(target, team.members)) - team.members, 0),
      skills: new Set(team.skills),
      interests: new Set<string>(),
      offsets: [],
      division: team.division,
    }));

  const taken = new Set(teams.map((team) => team.name.toLowerCase()));
  let number = teams.length;
  const divisions = [...new Set(people.map((person) => person.division))];
  for (const division of divisions) {
    const count = people.filter((person) => person.division === division).length;
    const room = slots
      .filter((slot) => slot.division === division)
      .reduce((sum, slot) => sum + slot.capacity, 0);
    for (let index = 0; index < Math.ceil(Math.max(count - room, 0) / target); index += 1) {
      let name: string;
      do {
        number += 1;
        name = newTeamName(number);
      } while (taken.has(name.toLowerCase()));
      taken.add(name.toLowerCase());
      slots.push({
        group: { team: null, name, members: [] },
        capacity: target,
        skills: new Set(),
        interests: new Set(),
        offsets: [],
        division,
      });
    }
  }

  const frequency = new Map<string, number>();
  for (const person of people) {
    for (const skill of person.skills) frequency.set(skill, (frequency.get(skill) ?? 0) + 1);
  }
  const rarity = (person: Person) =>
    person.skills.reduce((sum, skill) => sum + 1 / (frequency.get(skill) ?? 1), 0);
  const ordered = [...people].sort(
    (a, b) => rarity(b) - rarity(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

  const unmatched: string[] = [];
  const place = (person: Person, candidates: readonly Slot[]): boolean => {
    let best: Slot | null = null;
    let bestScore = -Infinity;
    for (const slot of candidates) {
      if (!fits(slot, person)) continue;
      const score = fitScore(slot, person);
      if (score > bestScore) {
        best = slot;
        bestScore = score;
      }
    }
    if (!best) return false;
    best.group.members.push(person.id);
    for (const skill of person.skills) best.skills.add(skill);
    for (const interest of person.interests) best.interests.add(interest);
    const offset = utcOffsetHours(person.timezone);
    if (offset !== null) best.offsets.push(offset);
    return true;
  };
  for (const person of ordered) {
    if (!place(person, slots)) unmatched.push(person.id);
  }

  const byId = new Map(people.map((person) => [person.id, person]));
  const kept: Slot[] = [];
  const orphans: string[] = [];
  for (const slot of slots) {
    const small = slot.group.team === null && slot.group.members.length < min;
    if (small) orphans.push(...slot.group.members);
    else if (slot.group.members.length > 0) kept.push(slot);
  }
  for (const id of orphans) {
    const person = byId.get(id);
    if (!person || !place(person, kept)) unmatched.push(id);
  }

  return { groups: kept.map((slot) => slot.group), unmatched };
}
