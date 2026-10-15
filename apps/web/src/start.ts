import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { createSerializationAdapter } from "@tanstack/react-router";
import { BogeyRequestError, type BogeyError } from "@bogey/db/errors";
import { securityHeaders } from "@bogey/config";
import { applyOperatorSettingsOnce } from "@bogey/db/instance-config";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const instanceMiddleware = createMiddleware().server(async ({ next }) => {
  await applyOperatorSettingsOnce();
  const result = await next();
  const headers = new Headers(result.response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const { body, status, statusText } = result.response;
  return { ...result, response: new Response(body, { status, statusText, headers }) };
});

const requestErrorAdapter = createSerializationAdapter({
  key: "bogey-request-error",
  test: (value): value is BogeyRequestError => value instanceof BogeyRequestError,
  toSerializable: (error): BogeyError => ({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
  }),
  fromSerializable: (value: BogeyError) => new BogeyRequestError(value),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [instanceMiddleware, csrfMiddleware],
  serializationAdapters: [requestErrorAdapter],
}));
