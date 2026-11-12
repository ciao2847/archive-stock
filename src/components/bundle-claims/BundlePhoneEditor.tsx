"use client";
import { ContactValueEditor } from "@/components/order-management/ContactValueEditor";
import { TAIWAN_MOBILE_PHONE_HTML_PATTERN } from "@/lib/claims";
export function BundlePhoneEditor({
  phone,
  disabled,
  onSave,
}: {
  phone: string;
  disabled: boolean;
  onSave: (phone: string) => Promise<boolean | undefined>;
}) {
  return (
    <ContactValueEditor
      value={phone}
      label="電話"
      fieldLabel="顧客手機號碼"
      type="tel"
      pattern={TAIWAN_MOBILE_PHONE_HTML_PATTERN}
      maxLength={10}
      disabled={disabled}
      onSave={onSave}
      help="只修改這筆配單；顧客對帳與電話查詢將使用新號碼。"
    />
  );
}
