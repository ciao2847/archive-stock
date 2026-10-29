import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_PATHS,
  getDashboardView,
  pushDashboardPath,
  backDashboardPath,
  restoreDashboardScroll,
} from "../src/lib/dashboard-navigation.ts";

test("every inventory view has a unique refreshable path", () => {
  assert.equal(
    new Set(Object.values(DASHBOARD_PATHS)).size,
    Object.keys(DASHBOARD_PATHS).length,
  );
  for (const [view, path] of Object.entries(DASHBOARD_PATHS)) {
    assert.equal(getDashboardView(path), view);
    assert.equal(getDashboardView(`${path}/`), view);
  }
  for (const path of [
    "/login",
    "/api/orders",
    "/qr/token",
    "/unknown",
    "/products/extra",
  ])
    assert.equal(getDashboardView(path), null);
});

test("dashboard Back uses tracked entries, restores filters and scroll, and never exits through unrelated browser history", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const entries: Array<{ url: URL; state: unknown }> = [
    { url: new URL("https://outside.example/"), state: null },
    {
      url: new URL("https://archive.example/orders?source=stall"),
      state: null,
    },
  ];
  let index = 1;
  const mock = {
    get location() {
      return entries[index].url;
    },
    scrollY: 0,
    scrollTo(_x: number, y: number) {
      this.scrollY = y;
    },
    history: {
      get state() {
        return entries[index].state;
      },
      get length() {
        return entries.length;
      },
      replaceState(state: unknown, _unused: string, path?: string) {
        entries[index] = {
          state,
          url: path ? new URL(path, entries[index].url) : entries[index].url,
        };
      },
      pushState(state: unknown, _unused: string, path: string) {
        entries.splice(index + 1);
        entries.push({ state, url: new URL(path, entries[index].url) });
        index++;
      },
      back() {
        index--;
      },
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: mock,
    configurable: true,
  });
  try {
    backDashboardPath();
    assert.equal(index, 1);
    assert.equal(mock.location.pathname, "/");
    pushDashboardPath("/products");
    mock.scrollY = 615;
    pushDashboardPath("/orders?source=stall&order=STALL-1");
    assert.equal(mock.scrollY, 0);
    const length = mock.history.length;
    pushDashboardPath("/orders?source=stall&order=STALL-1");
    assert.equal(mock.history.length, length);
    backDashboardPath();
    assert.equal(mock.location.pathname, "/products");
    assert.equal(restoreDashboardScroll(), 615);
    backDashboardPath();
    assert.equal(mock.location.pathname, "/");
    backDashboardPath();
    assert.equal(index, 1);
    assert.throws(() => pushDashboardPath("https://outside.example/products"));
    assert.throws(() => pushDashboardPath("/login"));
    assert.throws(() => pushDashboardPath("/api/orders"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
