"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseButton } from "@/components/ui/CloseButton";
import { useBackAction } from "@/components/navigation/BackNavigation";
import styles from "../../../styles/components/fanmade/FanmadeBatchDialog.module.scss";

export function FanmadeBatchDialog({
  open,
  busy,
  onClose,
  children,
  footer,
  status,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  status?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      element.close();
      return;
    }
    if (!element.open) element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      element.close();
    };
  }, [open]);
  useBackAction({
    enabled: open,
    priority: 160,
    hideButton: true,
    disabled: busy,
    onBack: () => {
      if (!busy) onClose();
    },
  });
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-modal="true"
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.header}>
        <div>
          <span className="eyebrow">飯製海報 · 批量上架</span>
          <h2 id={titleId}>飯製文字批量上架</h2>
        </div>
        <CloseButton
          aria-label="關閉飯製文字批量上架"
          disabled={busy}
          onClick={onClose}
        />
      </div>
      <div className={styles.body}>{children}</div>
      <div className={styles.footer}>
        <div className={styles.help}>
          {status}
          <p>關閉視窗會保留本頁草稿；重新整理前請先完成上架。</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="outline"
            disabled={busy}
            onClick={onClose}
          >
            返回飯製管理
          </button>
          {footer}
        </div>
      </div>
    </dialog>
  );
}
