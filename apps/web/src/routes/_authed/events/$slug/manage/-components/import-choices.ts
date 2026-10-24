import { useEffect, useReducer } from "react";
import { GUESS_LEVELS, type GuessLevel } from "@bogey/utils/roster";

// Auto-correct choices are picked before an import starts and stay fixed until it ends or starts over.
export interface ImportChoices {
  guess: GuessLevel;
  started: boolean;
}

export type ImportChoicesAction =
  | { type: "pick"; guess: GuessLevel }
  | { type: "start" }
  | { type: "startOver" };

export const FRESH_IMPORT: ImportChoices = { guess: "max", started: false };

export function importChoices(state: ImportChoices, action: ImportChoicesAction): ImportChoices {
  switch (action.type) {
    case "pick":
      return state.started || state.guess === action.guess
        ? state
        : { ...state, guess: action.guess };
    case "start":
      return state.started ? state : { ...state, started: true };
    case "startOver":
      return state.started ? { ...state, started: false } : state;
  }
}

const STORAGE_KEY = "bogey.rosterImport.guess";

export function savedGuess(): GuessLevel | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return GUESS_LEVELS.find((level) => level === value);
  } catch {
    return undefined;
  }
}

export function saveGuess(guess: GuessLevel) {
  try {
    localStorage.setItem(STORAGE_KEY, guess);
  } catch {
    // storage can be blocked
  }
}

/** Choices for the import in progress; a pick is remembered as the default for next time. */
export function useImportChoices() {
  const [state, dispatch] = useReducer(importChoices, FRESH_IMPORT);
  // read after mount so the server and first client render agree
  useEffect(() => {
    const saved = savedGuess();
    if (saved) dispatch({ type: "pick", guess: saved });
  }, []);
  return {
    ...state,
    pick: (guess: GuessLevel) => {
      if (state.started) return;
      saveGuess(guess);
      dispatch({ type: "pick", guess });
    },
    start: () => dispatch({ type: "start" }),
    startOver: () => dispatch({ type: "startOver" }),
  };
}
