"use client";
import { LoaderCircle, Trash2 } from "lucide-react";

export function RemoveRecordButton({
  onClick,
  disabled = false,
  busy = false,
  ariaLabel,
  reason,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel: string;
  reason?: string;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="outline min-h-9 text-[12px] text-danger hover:border-danger hover:bg-danger-soft"
        aria-label={ariaLabel}
        disabled={disabled || busy}
        onClick={onClick}
        title={reason}
      >
        {busy ? (
          <LoaderCircle size={15} className="animate-spin" />
        ) : (
          <Trash2 size={15} />
        )}
        {busy ? "移除中…" : "移除"}
      </button>
      {reason && (
        <p className="mb-0 mt-2 text-[11px] leading-5 text-muted">{reason}</p>
      )}
    </div>
  );
}
