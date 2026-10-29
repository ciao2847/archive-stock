"use client";

import { useId, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { StorageData } from "@/lib/location-storage";
import styles from "../../../styles/components/locations/StorageDestinationPicker.module.scss";

export function StorageDestinationPicker({
  data,
  value,
  source,
  disabled,
  onChange,
}: {
  data: StorageData;
  value: string;
  source?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const label = source ? "搬移至" : "目的庫位";
  const options = data.slots
    .filter((slot) => slot.id !== source)
    .map((slot) => {
      const cabinet = data.cabinets.find(
        (cabinet) => cabinet.id === slot.cabinet_id,
      );
      const name =
        slot.display_name && slot.display_name !== slot.code
          ? `${slot.display_name}（${slot.code}）`
          : slot.code;
      return { value: slot.id, label: `${cabinet?.name ?? ""}／${name}` };
    });
  function close() {
    if (details.current) details.current.open = false;
  }
  return (
    <div className={styles.field}>
      <span id={`${id}-label`}>{label}</span>
      <details
        ref={details}
        className={styles.picker}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current?.open) {
            event.preventDefault();
            event.stopPropagation();
            close();
            summary.current?.focus();
          }
        }}
      >
        <summary
          ref={summary}
          aria-label={label}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <span>
            {options.find((option) => option.value === value)?.label ??
              "選擇庫位"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div
          className={styles.options}
          role="group"
          aria-labelledby={`${id}-label`}
        >
          {options.map((option) => (
            <label key={option.value} data-selected={option.value === value}>
              <input
                type="radio"
                name={id}
                value={option.value}
                checked={option.value === value}
                disabled={disabled}
                onChange={() => {
                  onChange(option.value);
                  close();
                  summary.current?.focus();
                }}
              />
              <span>{option.label}</span>
              {option.value === value && <Check size={16} aria-hidden="true" />}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
