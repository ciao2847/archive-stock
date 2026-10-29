"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ArrowLeft } from "lucide-react";
import type { DashboardView } from "@/lib/types";
import styles from "../../../styles/components/navigation/BackNavigation.module.scss";

type Action = {
  id: string;
  priority: number;
  disabled: boolean;
  hideButton: boolean;
  onBack: () => void;
};
type Navigation = {
  view: DashboardView;
  setView: (view: DashboardView) => void;
  goBack: () => void;
};
const Context = createContext<
  | (Navigation & {
      canGoBack: boolean;
      backDisabled: boolean;
      hideBackButton: boolean;
      register: (action: Action) => () => void;
      cache: Map<string, unknown>;
    })
  | null
>(null);

export function BackNavigationProvider({
  children,
  navigation,
}: {
  children: ReactNode;
  navigation: Navigation;
}) {
  const [actions, setActions] = useState<Action[]>([]);
  const [cache] = useState(() => new Map<string, unknown>());
  const register = useCallback((action: Action) => {
    setActions((current) => [
      ...current.filter((item) => item.id !== action.id),
      action,
    ]);
    return () =>
      setActions((current) => current.filter((item) => item.id !== action.id));
  }, []);
  const value = useMemo(
    () => ({
      ...navigation,
      register,
      cache,
      canGoBack: actions.length > 0 || navigation.view !== "dashboard",
      hideBackButton: actions.some((action) => action.hideButton),
      backDisabled:
        [...actions].sort((a, b) => b.priority - a.priority).at(0)?.disabled ??
        false,
      goBack: () => {
        const active = [...actions]
          .sort((a, b) => b.priority - a.priority)
          .at(0);
        if (active) {
          if (!active.disabled) active.onBack();
        } else navigation.goBack();
      },
    }),
    [navigation, actions, register, cache],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBackNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error("BackNavigationProvider is required");
  return context;
}

export function useBackAction({
  enabled = true,
  priority = 10,
  disabled = false,
  hideButton = false,
  onBack,
}: {
  enabled?: boolean;
  priority?: number;
  disabled?: boolean;
  hideButton?: boolean;
  onBack: () => void;
}) {
  const context = useContext(Context);
  const register = context?.register;
  const id = useId();
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);
  useEffect(() => {
    if (!enabled || !register) return;
    return register({
      id,
      priority,
      disabled,
      hideButton,
      onBack: () => callback.current(),
    });
  }, [enabled, priority, disabled, hideButton, register, id]);
}

export function useDirtyBack({
  onBack,
  busy = false,
  dirty = false,
  enabled = true,
  priority = 100,
  hideButton = false,
}: {
  onBack: () => void;
  busy?: boolean;
  dirty?: boolean;
  enabled?: boolean;
  priority?: number;
  hideButton?: boolean;
}) {
  const [changed, setChanged] = useState(false);
  const requestBack = () => {
    if (busy) return;
    if (
      (changed || dirty) &&
      !window.confirm("有尚未儲存的修改，確定放棄修改並返回？")
    )
      return;
    onBack();
  };
  useBackAction({
    enabled,
    priority,
    disabled: busy,
    hideButton,
    onBack: requestBack,
  });
  const markChanged = useCallback((event: FormEvent<HTMLElement>) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === "search"
    )
      return;
    setChanged(true);
  }, []);
  const resetChanged = useCallback(() => setChanged(false), []);
  return {
    requestBack,
    markChanged,
    resetChanged,
  };
}

// Keep list filters while navigating between dashboard pages. The cache is
// scoped to this mounted, authenticated dashboard; it never survives logout.
export function useNavigationState<T>(key: string, initial: T | (() => T)) {
  const context = useContext(Context);
  const cache = context?.cache;
  const [value, setValue] = useState<T>(() =>
    cache?.has(key)
      ? (cache.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial,
  );
  useEffect(() => {
    cache?.set(key, value);
  }, [cache, key, value]);
  return [value, setValue] as [T, Dispatch<SetStateAction<T>>];
}

export function BackButton({
  onBack,
  disabled = false,
}: {
  onBack?: () => void;
  disabled?: boolean;
}) {
  const context = useContext(Context);
  if (!onBack && (!context?.canGoBack || context.hideBackButton)) return null;
  return (
    <button
      type="button"
      className={styles.back}
      aria-label="返回"
      disabled={disabled || (!onBack && context?.backDisabled)}
      onClick={onBack ?? context?.goBack}
    >
      <ArrowLeft size={18} aria-hidden="true" />
      <span>返回</span>
    </button>
  );
}
