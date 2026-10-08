"use client";
import { useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";

export function OrderContactDetails({
  name,
  phone,
  notes,
  metadata,
  actions,
  badge,
}: {
  name: string;
  phone?: string;
  notes?: string;
  metadata: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  async function copyPhone() {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(phone);
      window.setTimeout(() => setCopiedPhone(null), 1800);
    } catch {
      window.prompt("複製顧客手機號碼", phone);
    }
  }
  return (
    <div className="mt-3 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {badge}
          <strong className="break-words text-[18px] text-dark">{name}</strong>
        </div>
        {phone && (
          <span className="inline-flex items-center gap-2">
            <a
              href={`tel:${phone}`}
              className="text-[13px] font-semibold text-primary no-underline hover:underline"
            >
              {phone}
            </a>
            <button
              type="button"
              className="icon-btn size-7"
              aria-label="複製手機號碼"
              onClick={() => void copyPhone()}
            >
              {copiedPhone === phone ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </span>
        )}
      </div>
      {notes && (
        <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-[12px] text-muted">
          備註：{notes}
        </p>
      )}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      <details className="mt-3 rounded-[8px] border border-line px-3 py-2 text-[12px]">
        <summary className="cursor-pointer font-semibold text-muted">
          詳細資料
        </summary>
        <div className="mt-2 space-y-1 break-words text-muted">{metadata}</div>
      </details>
    </div>
  );
}
