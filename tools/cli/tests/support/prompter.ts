import { Cancelled, settle, type Prompter } from "../../src/lib/prompt.ts";

export function scripted(answers: Array<string | boolean>) {
  const queue = [...answers];
  const asked: string[] = [];
  const said: string[] = [];
  const next = (message: string) => {
    asked.push(message);
    if (queue.length === 0) throw new Cancelled();
    return queue.shift();
  };
  const prompter: Prompter = {
    text: async (question) => {
      const raw = next(question.message);
      if (typeof raw !== "string") throw new Error(`"${question.message}" wants text`);
      const answer = settle(question, raw);
      if ("error" in answer) throw new Error(`"${question.message}": ${answer.error}`);
      return answer.value;
    },
    select: async (question) => {
      const raw = next(question.message);
      const picked = question.options.find(
        (option) => option.value === raw || option.label === raw,
      );
      if (!picked) throw new Error(`"${String(raw)}" isn't a choice for "${question.message}"`);
      return picked.value;
    },
    confirm: async (question) => {
      const raw = next(question.message);
      if (typeof raw !== "boolean") throw new Error(`"${question.message}" wants yes or no`);
      return raw;
    },
    say: (text) => said.push(text),
  };
  return { prompter, asked, said };
}
