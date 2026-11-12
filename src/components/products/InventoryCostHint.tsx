"use client";
import { useEffect, useState } from "react";
import { getInventoryAccountingMode } from "@/lib/api/inventory-costs";
export function InventoryCostHint({ ownerId }: { ownerId: string }) {
  const [fifo, setFifo] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getInventoryAccountingMode(ownerId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFifo(data.mode === "product_fifo");
      })
      .catch(() => {
        if (!controller.signal.aborted) setFifo(false);
      });
    return () => controller.abort();
  }, [ownerId]);
  if (!fifo) return null;
  return (
    <p className="text-sm text-muted">
      此庫藏採用批次成本。儲存新增商品或增加庫存後，請開啟商品資料的「進貨批次與成本」，填寫本批單件成本；也可於會計結算前補登。
    </p>
  );
}
