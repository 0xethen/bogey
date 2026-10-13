export const REQUEST_TIMEOUT_MS = 4000;

const FAIL_FAST_MS = 3000;
const unreachableUntil = new Map<string, number>();

export function resetUnreachable() {
  unreachableUntil.clear();
}

function originOf(input: Parameters<typeof fetch>[0]): string | null {
  try {
    const url = input instanceof Request ? input.url : input;
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function timeoutFetch(ms: number = REQUEST_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const origin = originOf(input);
    if (origin && (unreachableUntil.get(origin) ?? 0) > Date.now()) {
      throw new TypeError("fetch failed", { cause: new Error("recently unreachable") });
    }
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    try {
      const response = await fetch(input, { ...init, signal });
      if (origin) unreachableUntil.delete(origin);
      return response;
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      if (origin && (timedOut || error instanceof TypeError)) {
        unreachableUntil.set(origin, Date.now() + FAIL_FAST_MS);
      }
      if (timedOut) throw new TypeError("fetch failed", { cause: error });
      throw error;
    }
  };
}
