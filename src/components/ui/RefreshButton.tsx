"use client";

import type { MouseEventHandler } from "react";
import { RefreshCw } from "lucide-react";
import styles from "../../../styles/components/ui/RefreshButton.module.scss";

type RefreshButtonProps = {
  onClick: MouseEventHandler<HTMLButtonElement>;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function RefreshButton({
  onClick,
  loading = false,
  disabled = false,
  label = "重新載入",
  className = "",
}: RefreshButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-busy={loading}
      title={label}
    >
      <RefreshCw
        size={18}
        aria-hidden="true"
        className={loading ? styles.spinning : undefined}
      />
    </button>
  );
}
