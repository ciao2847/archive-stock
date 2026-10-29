import { countryLabel, COUNTRIES } from "@/constants";
import { buildPreorderProductName } from "@/lib/preorder-product-name";
import { ProductFormField as Field } from "./ProductFormField";

export function PreorderNameFields({
  work,
  itemName,
  country,
  onWorkChange,
  onItemNameChange,
  onCountryChange,
  requireItemName = false,
  workError,
  itemError,
  countryError,
}: {
  work: string;
  itemName: string;
  country: string;
  onWorkChange: (value: string) => void;
  onItemNameChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  requireItemName?: boolean;
  workError?: string;
  itemError?: string;
  countryError?: string;
}) {
  const name = buildPreorderProductName(country, work, itemName);
  return (
    <>
      <Field label="作品名稱" error={workError}>
        <input
          value={work}
          onChange={(e) => onWorkChange(e.target.value)}
          required
          maxLength={200}
          placeholder="例：蜘蛛人"
        />
      </Field>
      <Field
        label={`品項名稱（${requireItemName ? "必填" : "選填"}）`}
        error={itemError}
      >
        <input
          value={itemName}
          onChange={(e) => onItemNameChange(e.target.value)}
          required={requireItemName}
          maxLength={200}
          placeholder="例：A款、B款、全員款、肖像款"
        />
      </Field>
      <Field label="國家版本" error={countryError}>
        <select
          value={country}
          onChange={(e) => onCountryChange(e.target.value)}
          required
        >
          <option value="">請選擇國家版本</option>
          {COUNTRIES.map((value) => (
            <option key={value} value={value}>
              {countryLabel(value)}
            </option>
          ))}
        </select>
      </Field>
      <div
        className="col-span-full rounded-lg border border-line bg-light/45 p-3"
        role="status"
        aria-live="polite"
        aria-label="商品名稱預覽"
      >
        <span className="block text-[12px] text-muted">
          訂購頁與庫存商品名稱
        </span>
        <strong className="mt-1 block break-words text-[15px]">
          {work.trim() ? name : "填寫作品、品項與國家後自動組合"}
        </strong>
      </div>
    </>
  );
}
