import { errorCode } from "@bogey/db/errors";
import { toast } from "@bogey/ui/components/toast";
import { isVerbose } from "./verbose.ts";

export function describeError(error: unknown, verbose: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  return verbose ? `${message}\n${errorCode(error)}` : message;
}

export function toastError(title: string, error: unknown) {
  toast.add({ title, description: describeError(error, isVerbose()) });
}
