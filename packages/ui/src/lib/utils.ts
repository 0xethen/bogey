export { cn } from "cn";

export function viewTransition(callback: () => void): void {
  if (!document.startViewTransition) {
    callback();
    return;
  }
  const transition = document.startViewTransition(callback);
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}

export function parseLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;

  return new Date(year, month - 1, day);
}

export function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}
