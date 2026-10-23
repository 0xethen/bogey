// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vite-plus/test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { loadedContext } from "#/lib/routing.ts";
import { useEventViewer, useRealEventAccess } from "#/lib/viewer.ts";

// Reads the event the way the header, preview bar and error page do.
function EventProbe() {
  const viewer = useEventViewer();
  const real = useRealEventAccess();
  return <p>event {viewer?.event.id ?? real?.event.id ?? "none"}</p>;
}

function ErrorPage() {
  return (
    <>
      <EventProbe />
      <p>retryable error</p>
    </>
  );
}

// root > _authed > events/$slug > index, the same route ids as the app
function setup(failing: { root: boolean; authed: boolean }) {
  const root = createRootRoute({
    beforeLoad: async () => {
      if (failing.root) throw new TypeError("fetch failed");
    },
    component: () => (
      <>
        <EventProbe />
        <Outlet />
      </>
    ),
    errorComponent: ErrorPage,
  });
  const authed = createRoute({
    getParentRoute: () => root,
    id: "_authed",
    beforeLoad: async () => {
      if (failing.authed) throw new TypeError("fetch failed");
      return { session: { id: "session" } };
    },
    errorComponent: ErrorPage,
  });
  const event = createRoute({
    getParentRoute: () => authed,
    path: "events/$slug",
    beforeLoad: async () => ({ event: { id: "event-1" }, access: { role: null } }),
  });
  const home = createRoute({ getParentRoute: () => event, path: "/", component: () => "home" });
  const router = createRouter({
    routeTree: root.addChildren([authed.addChildren([event.addChildren([home])])]),
    history: createMemoryHistory({ initialEntries: ["/events/demo"] }),
  });
  return router;
}

async function loadThenFail(part: "root" | "authed") {
  const failing = { root: false, authed: false };
  const router = setup(failing);
  await router.load();
  render(
    <QueryClientProvider client={new QueryClient()}>
      {/* test routes aren't the registered app tree */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("event event-1")).toBeTruthy();
  failing[part] = true;
  await act(() => router.invalidate());
  return router;
}

afterEach(cleanup);

describe("a parent's failed beforeLoad", () => {
  test("leaves the event match 'success' with an empty context (router behavior we guard)", async () => {
    const router = await loadThenFail("authed");
    const match = router.state.matches.find((each) => each.routeId === "/_authed/events/$slug");
    expect(match?.status).toBe("success");
    expect(match?.context).toEqual({});
  });

  test("on the root shows our error page, not the router's", async () => {
    await loadThenFail("root");
    expect(screen.getByText("retryable error")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Something went wrong");
    expect(document.body.textContent).not.toContain("reading 'id'");
  });

  test("under the root keeps the shell around our error page", async () => {
    await loadThenFail("authed");
    expect(screen.getByText("retryable error")).toBeTruthy();
    expect(screen.getAllByText("event none")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Something went wrong");
  });
});

describe("loadedContext", () => {
  test("needs the success status and the beforeLoad key", () => {
    const context = { event: { id: "e" } };
    expect(loadedContext({ status: "success", context }, "event")).toBe(context);
    expect(loadedContext({ status: "pending", context }, "event")).toBeUndefined();
    const emptied: Partial<typeof context> = {};
    expect(loadedContext({ status: "success", context: emptied }, "event")).toBeUndefined();
  });
});
