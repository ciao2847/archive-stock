import type { DashboardView } from "./types";

export const DASHBOARD_PATHS: Record<DashboardView, string> = {
  dashboard: "/",
  products: "/products",
  claims: "/claims",
  "bundle-claims": "/bundle-claims",
  orders: "/orders",
  packing: "/packing",
  checkout: "/checkout",
  "stall-sales": "/stall-sales",
  locations: "/locations",
  settlement: "/settlement",
  settings: "/settings",
};

export function getDashboardView(pathname: string): DashboardView | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    (Object.keys(DASHBOARD_PATHS) as DashboardView[]).find(
      (view) => DASHBOARD_PATHS[view] === normalized,
    ) ?? null
  );
}

const stateKey = "archiveDashboardNavigation";
type Entry = { path: string; depth: number; scrollY: number };

function currentPath() {
  return window.location.pathname + window.location.search;
}

function entry(): Entry {
  const value = window.history.state?.[stateKey] as Entry | undefined;
  return value?.path === currentPath() &&
    Number.isSafeInteger(value.depth) &&
    value.depth >= 0 &&
    Number.isFinite(value.scrollY) &&
    value.scrollY >= 0
    ? value
    : { path: currentPath(), depth: 0, scrollY: 0 };
}

export function saveDashboardScroll() {
  window.history.replaceState(
    { [stateKey]: { ...entry(), scrollY: window.scrollY } },
    "",
  );
}

export function pushDashboardPath(path: string) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || !getDashboardView(url.pathname))
    throw new Error("Invalid dashboard destination");
  const nextPath = url.pathname + url.search;
  if (currentPath() === nextPath) return;
  const depth = entry().depth;
  saveDashboardScroll();
  // Pass our own state only; Next.js adds its internal router state itself.
  window.history.pushState(
    { [stateKey]: { path: nextPath, depth: depth + 1, scrollY: 0 } },
    "",
    nextPath,
  );
  window.scrollTo(0, 0);
}

export function backDashboardPath() {
  if (entry().depth > 0 && window.history.length > 1) {
    saveDashboardScroll();
    window.history.back();
  } else {
    window.history.replaceState(
      { [stateKey]: { path: "/", depth: 0, scrollY: 0 } },
      "",
      "/",
    );
    window.scrollTo(0, 0);
  }
}

export function restoreDashboardScroll() {
  return entry().scrollY;
}
