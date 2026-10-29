"use client";

import { useState, type CSSProperties } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "../../../styles/components/ui/QuantityStepper.module.scss";

type QuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  disabled?: boolean;
  label: string;
  itemName: string;
  className?: string;
  style?: CSSProperties;
};

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
  label,
  itemName,
  className = "",
  style,
}: QuantityStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) =>
    Math.max(min, Math.min(max, Math.trunc(next)));
  function change(next: number) {
    setDraft(null);
    if (Number.isFinite(next)) onChange(clamp(next));
  }
  return (
    <div className={`${styles.stepper} ${className}`} style={style}>
      <button
        type="button"
        aria-label={`減少 ${itemName} 數量`}
        disabled={disabled || value <= min}
        onClick={() => change(value - 1)}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        aria-label={label}
        value={draft ?? value}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            setDraft("");
            return;
          }
          change(Number(raw));
        }}
        onBlur={() => {
          if (draft !== null) change(min);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            change(value + (event.key === "ArrowUp" ? 1 : -1));
          }
        }}
      />
      <button
        type="button"
        aria-label={`增加 ${itemName} 數量`}
        disabled={disabled || value >= max}
        onClick={() => change(value + 1)}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
