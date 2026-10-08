"use client";
import { LoaderCircle } from "lucide-react";

export type PaymentEditorValues = {
  amount: string;
  transferredAt: string;
  lastFive: string;
  note: string;
};
export function PaymentRecordEditor({
  values,
  onChange,
  amountReadOnly,
  maximumAmount,
  presets,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  values: PaymentEditorValues;
  onChange: (values: PaymentEditorValues) => void;
  amountReadOnly: boolean;
  maximumAmount: number;
  presets?: Array<{ label: string; amount: number }>;
  saving: boolean;
  error?: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const update = (field: keyof PaymentEditorValues, value: string) =>
    onChange({ ...values, [field]: value });
  const inputClass =
    "mt-1.5 block min-h-10 w-full rounded-[7px] border border-line bg-white px-3 text-[16px] outline-none focus:border-primary";
  return (
    <form
      aria-label="匯款紀錄表單"
      className="rounded-[8px] bg-light/45 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) onSubmit();
      }}
    >
      <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
        <h5 className="m-0 text-[12px] font-bold text-dark">新增匯款紀錄</h5>
        <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-[11px] font-semibold text-dark">
            匯款金額
            <input
              className={inputClass}
              type="number"
              min="0.01"
              max={maximumAmount}
              step="0.01"
              value={values.amount}
              readOnly={amountReadOnly}
              required
              onChange={(event) => update("amount", event.target.value)}
            />
            {presets && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded-full border border-line bg-white px-2 py-0.5 text-[10px] font-medium text-primary"
                    onClick={() => update("amount", String(preset.amount))}
                  >
                    {preset.label}
                  </button>
                ))}
              </span>
            )}
          </label>
          <label className="min-w-0 text-[11px] font-semibold text-dark">
            匯款日期時間
            <input
              className={inputClass}
              type="datetime-local"
              required
              value={values.transferredAt}
              onChange={(event) => update("transferredAt", event.target.value)}
            />
          </label>
          <label className="min-w-0 text-[11px] font-semibold text-dark">
            匯款帳號末五碼（選填）
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={5}
              pattern="[0-9]{5}"
              value={values.lastFive}
              placeholder="12345"
              onChange={(event) =>
                update(
                  "lastFive",
                  event.target.value.replace(/\D/g, "").slice(0, 5),
                )
              }
            />
          </label>
          <label className="min-w-0 text-[11px] font-semibold text-dark">
            備註（選填）
            <input
              className={inputClass}
              maxLength={1000}
              value={values.note}
              onChange={(event) => update("note", event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="mb-0 mt-2 text-[12px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="outline min-h-9 text-[11px]"
            onClick={onCancel}
            aria-label="關閉匯款紀錄表單"
          >
            取消
          </button>
          <button
            type="submit"
            className="primary min-h-9 text-[11px]"
            disabled={!values.amount || !values.transferredAt}
          >
            {saving && <LoaderCircle size={13} className="animate-spin" />}
            {saving ? "儲存中…" : "儲存匯款紀錄"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
