"use client";

import { useId } from "react";
import { LoaderCircle } from "lucide-react";

export function AvailabilitySwitch({
  label,
  enabled,
  busy,
  disabled = false,
  enabledText,
  description,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  busy: boolean;
  disabled?: boolean;
  enabledText: string;
  description: string;
  onToggle: () => void;
}) {
  const descriptionId = useId();
  return (
    <div className="min-w-0 rounded-[10px] border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold text-dark">{label}</span>
        <button
          type="button"
          role="switch"
          aria-label={label}
          aria-checked={enabled}
          aria-describedby={descriptionId}
          aria-busy={busy}
          disabled={busy || disabled}
          onClick={onToggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60 ${enabled ? "bg-primary" : "bg-gray-400"}`}
        >
          <span
            className={`grid size-5 place-items-center rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
          >
            {busy && (
              <LoaderCircle size={13} className="animate-spin text-primary" />
            )}
          </span>
        </button>
        <span
          role="status"
          className={`text-[12px] font-semibold ${enabled ? "text-primary" : "text-muted"}`}
        >
          {busy ? "儲存中…" : enabled ? enabledText : "已暫停"}
        </span>
      </div>
      <p
        id={descriptionId}
        className="mb-0 mt-2 text-[11px] leading-5 text-muted"
      >
        {description}
      </p>
    </div>
  );
}
