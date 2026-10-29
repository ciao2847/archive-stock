"use client";

import { useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DASHBOARD_PATHS, getDashboardView } from "../lib/dashboard-navigation";
import type { DashboardView } from "../lib/types";
import {
  backDashboardPath,
  pushDashboardPath,
  restoreDashboardScroll,
  saveDashboardScroll,
} from "../lib/dashboard-navigation";

export function useDashboardNavigation() {
  const pathname = usePathname();
  const view = getDashboardView(pathname) ?? "dashboard";
  const setView = useCallback((nextView: DashboardView) => {
    const path = DASHBOARD_PATHS[nextView];
    if (getDashboardView(window.location.pathname) === nextView) return;
    // Next.js integrates native history updates with usePathname. Keep the
    // dashboard mounted while recording real entries for Back and Forward.
    pushDashboardPath(path);
  }, []);
  useEffect(() => {
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let frame = 0;
    let scrollTimer: ReturnType<typeof setTimeout>;
    const restore = () => {
      const y = restoreDashboardScroll();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => window.scrollTo(0, y));
      });
    };
    const save = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(saveDashboardScroll, 120);
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(scrollTimer);
      window.history.scrollRestoration = restoration;
      window.removeEventListener("popstate", restore);
      window.removeEventListener("scroll", save);
    };
  }, []);
  return { view, setView, goBack: backDashboardPath };
}
