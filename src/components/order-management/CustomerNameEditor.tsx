"use client";
import { ContactValueEditor } from "./ContactValueEditor";
import { readApiResponse } from "@/lib/api/http-client";
export function CustomerNameEditor({
  ownerId,
  source,
  recordId,
  name,
  disabled = false,
  onSaved,
}: {
  ownerId: string;
  source: "claim" | "bundle" | "order";
  recordId: string | number;
  name: string;
  disabled?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  return (
    <ContactValueEditor
      value={name}
      label="名稱"
      fieldLabel="顧客名稱"
      maxLength={100}
      disabled={disabled}
      help="只修改這筆紀錄的顧客名稱，相關包貨資料會同步更新。"
      onSave={async (nextName) => {
        const response = await fetch("/api/customer-name", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerId,
            source,
            recordId: String(recordId),
            expectedName: name,
            name: nextName,
          }),
        });
        const result = await readApiResponse<{ updated: boolean }>(response);
        if (!result.updated)
          throw new Error("名稱未能更新，請重新整理後再試。");
        await onSaved();
        return true;
      }}
    />
  );
}
