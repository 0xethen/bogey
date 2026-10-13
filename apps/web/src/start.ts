import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { createSerializationAdapter } from "@tanstack/react-router";
import { BogeyRequestError, type BogeyError } from "@bogey/db/errors";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
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
  requestMiddleware: [csrfMiddleware],
  serializationAdapters: [requestErrorAdapter],
}));
