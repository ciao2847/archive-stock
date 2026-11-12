"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { CloseButton } from "@/components/ui/CloseButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useBackAction } from "@/components/navigation/BackNavigation";
import styles from "../../../styles/components/order-management/ContactValueEditor.module.scss";

export function ContactValueEditor({
  value: originalValue,
  label,
  fieldLabel,
  help,
  type = "text",
  pattern,
  maxLength,
  disabled,
  onSave,
}: {
  value: string;
  label: string;
  fieldLabel: string;
  help: string;
  type?: "text" | "tel";
  pattern?: string;
  maxLength: number;
  disabled: boolean;
  onSave: (value: string) => Promise<boolean | undefined>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(originalValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const helpId = useId();
  const busy = disabled || saving;
  useEffect(() => {
    if (!editing) return;
    const element = dialog.current;
    const button = trigger.current;
    element?.showModal();
    valueInput.current?.focus();
    return () => {
      element?.close();
      if (button?.isConnected) button.focus();
    };
  }, [editing]);
  useBackAction({
    enabled: editing,
    disabled: busy,
    priority: 100,
    onBack: () => setEditing(false),
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon-btn size-7"
        aria-label={`修改${label}`}
        title={`修改${label}`}
        disabled={busy}
        onClick={() => {
          setValue(originalValue);
          setError("");
          setEditing(true);
        }}
      >
        <Pencil size={13} aria-hidden="true" />
      </button>
      {editing &&
        createPortal(
          <dialog
            ref={dialog}
            className={styles.dialog}
            aria-labelledby={titleId}
            aria-describedby={helpId}
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setEditing(false);
            }}
          >
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || inFlight.current) return;
                inFlight.current = true;
                setSaving(true);
                setError("");
                try {
                  if (await onSave(value.trim())) setEditing(false);
                  else
                    setError(
                      `${label}未能更新。請稍後再試；若配單已變更，請關閉視窗並重新整理。`,
                    );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : `${label}更新失敗，請稍後再試。`,
                  );
                } finally {
                  inFlight.current = false;
                  setSaving(false);
                }
              }}
            >
              <div className={styles.header}>
                <h2 id={titleId}>修改顧客{label}</h2>
                <CloseButton
                  aria-label={`關閉${label}編輯`}
                  disabled={busy}
                  onClick={() => setEditing(false)}
                />
              </div>
              <div className={styles.body}>
                <label className="field">
                  <span>{fieldLabel}</span>
                  <input
                    type={type}
                    autoComplete={type === "tel" ? "tel" : "off"}
                    inputMode={type === "tel" ? "numeric" : "text"}
                    required
                    ref={valueInput}
                    pattern={pattern}
                    maxLength={maxLength}
                    title={type === "tel" ? "09[0-9]{8}" : undefined}
                    value={value}
                    disabled={busy}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
                <p id={helpId}>{help}</p>
                {error && <ErrorMessage>{error}</ErrorMessage>}
              </div>
              <div className={styles.footer}>
                <button
                  type="button"
                  className="outline"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    busy || !value.trim() || value.trim() === originalValue
                  }
                >
                  {saving ? "儲存中…" : `儲存${label}`}
                </button>
              </div>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
