"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBackAction } from "@/components/navigation/BackNavigation";
import styles from "../../../styles/components/order-management/CustomerDetailsLayout.module.scss";

const OpenDetailsContext = createContext<(key: string) => void>(() => {});
export const useOpenCustomerDetails = () => useContext(OpenDetailsContext);

export function CustomerDetailsLayout({
  list,
  children,
  selectedKey,
  disabled = false,
}: {
  list: ReactNode;
  children: ReactNode;
  selectedKey?: string;
  disabled?: boolean;
}) {
  const [openedKey, setOpenedKey] = useState<string>();
  const [mobile, setMobile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const scrollPositions = useRef<
    Array<{ element: HTMLElement; top: number; left: number }>
  >([]);
  const windowPosition = useRef({ top: 0, left: 0 });
  const restore = useRef(false);
  const showingDetails = Boolean(openedKey && openedKey === selectedKey);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function open(key: string) {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    windowPosition.current = { top: window.scrollY, left: window.scrollX };
    scrollPositions.current = [];
    for (
      let element = listRef.current?.parentElement;
      element;
      element = element.parentElement
    ) {
      scrollPositions.current.push({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    }
    setOpenedKey(key);
  }

  function back() {
    restore.current = true;
    setOpenedKey(undefined);
  }

  useBackAction({
    enabled: mobile && showingDetails,
    priority: 50,
    disabled,
    onBack: back,
  });

  useLayoutEffect(() => {
    if (!mobile) return;
    if (showingDetails) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    } else if (restore.current) {
      restore.current = false;
      trigger.current?.focus({ preventScroll: true });
      for (const { element, top, left } of scrollPositions.current) {
        element.scrollTo({ top, left, behavior: "instant" });
      }
      window.scrollTo({ ...windowPosition.current, behavior: "instant" });
    }
  }, [mobile, showingDetails]);

  return (
    <OpenDetailsContext.Provider value={open}>
      <div className={styles.layout}>
        <div
          ref={listRef}
          className={showingDetails ? styles.hiddenOnMobile : styles.pane}
        >
          {list}
        </div>
        <div
          ref={detailRef}
          tabIndex={-1}
          className={`${styles.detail} ${showingDetails ? "" : styles.hiddenOnMobile}`}
        >
          {children}
        </div>
      </div>
    </OpenDetailsContext.Provider>
  );
}
