"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Spinner } from "./Spinner";

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className = "",
  maxLength,
  onSearch,
  onClear,
  clearLabel = "清除搜尋",
  busy = false,
  invalid,
  describedBy,
  shortcut = false,
  withinForm = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
  maxLength?: number;
  onSearch?: () => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  clearLabel?: string;
  busy?: boolean;
  invalid?: boolean;
  describedBy?: string;
  shortcut?: boolean;
  withinForm?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [shortcut]);

  function search() {
    if (busy) return;
    void onSearch?.();
    inputRef.current?.blur();
  }

  function clear() {
    if (onClear) void onClear();
    else onChange("");
    inputRef.current?.focus();
  }

  const Container = withinForm ? "div" : "form";

  return (
    <Container
      className={`search ${className}`}
      role="search"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        search();
      }}
    >
      <Search className="shrink-0" size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && withinForm) {
            event.preventDefault();
            event.stopPropagation();
            search();
            return;
          }
          if (event.key !== "Escape") return;
          event.preventDefault();
          if (value) {
            event.stopPropagation();
            clear();
          } else event.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        maxLength={maxLength}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={clear}
          aria-label={clearLabel}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
      <button
        type={withinForm ? "button" : "submit"}
        onClick={withinForm ? search : undefined}
        disabled={busy}
        className="search-submit"
        aria-label={busy ? "查詢中" : "查詢"}
      >
        {busy ? <Spinner size={14} /> : <Search size={14} aria-hidden="true" />}
        <span>{busy ? "查詢中" : "查詢"}</span>
      </button>
    </Container>
  );
}
