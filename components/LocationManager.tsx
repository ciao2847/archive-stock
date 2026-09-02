"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, MapPin, Plus, Warehouse } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { LOCATION_CODE_PATTERN } from "@/lib/config";
import { DEFAULT_VALUES } from "@/lib/defaults";
import { DataState } from "./DataState";

type LocationRow = {
  id: string;
  code: string;
  cabinet: string | null;
  shelf: number | null;
  bin: number | null;
  description: string | null;
  count: number;
};

/** 庫位管理面板。 */
export function LocationManager() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const [
      { data: rows, error: locationError },
      { data: productRows, error: productError },
    ] = await Promise.all([
      supabase
        .from("locations")
        .select("id,code,cabinet,shelf,bin,description")
        .order("code"),
      supabase.from("products").select("location_id"),
    ]);
    if (locationError || productError) {
      setError((locationError || productError)?.message || "讀取失敗");
      setLoading(false);
      return;
    }
    const counts = new Map<string, number>();
    productRows?.forEach((row) => {
      if (row.location_id)
        counts.set(
          row.location_id,
          (counts.get(row.location_id) ?? DEFAULT_VALUES.count) + 1,
        );
    });
    setLocations(
      (rows || []).map((row) => ({
        ...row,
        count: counts.get(row.id) ?? DEFAULT_VALUES.count,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!LOCATION_CODE_PATTERN.test(normalized)) {
      setError("庫位格式應為 A-03-02");
      return;
    }
    const [cabinet, shelf, bin] = normalized.split("-");
    setSaving(true);
    setError("");
    const { error } = await createClient()
      .from("locations")
      .insert({
        code: normalized,
        cabinet,
        shelf: Number(shelf),
        bin: Number(bin),
        description: description.trim() || null,
      });
    if (error)
      setError(error.code === "23505" ? "這個庫位已經存在" : error.message);
    else {
      setCode("");
      setDescription("");
      await load();
    }
    setSaving(false);
  }

  return (
    <div className="grid grid-cols-[340px_1fr] items-start gap-4 max-xl:grid-cols-1">
      <section className="card h-max [&_form]:px-[22px] [&_form]:pb-[22px] [&_label]:mb-3 [&_label]:block [&_label]:text-[12px] [&_label]:font-semibold [&_input]:mt-[6px] [&_input]:block [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--color-line)] [&_input]:bg-[var(--color-white)] [&_input]:p-[11px] [&_input]:outline-none max-lg:[&_input]:text-[16px] [&_.primary]:mt-3 [&_.primary]:w-full">
        <div className="card-head">
          <div>
            <h2>建立新庫位</h2>
            <p>格式：櫃－層－格，例如 A-03-02</p>
          </div>
        </div>
        <form onSubmit={addLocation}>
          <label>
            庫位代碼
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="A-03-02"
              required
            />
          </label>
          <label>
            說明（選填）
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A 櫃第三層第二格"
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Plus />}
            {saving ? "建立中…" : "新增庫位"}
          </button>
        </form>
      </section>
      <section className="card location-list w-full self-start">
        <div className="card-head">
          <div>
            <h2>全部庫位</h2>
            <p>{locations.length} 個庫位</p>
          </div>
        </div>
        <DataState
          loading={loading}
          isEmpty={locations.length === 0}
          loadingText="正在讀取庫位…"
          emptyContent={
            <div className="flex flex-col items-center gap-2">
              <Warehouse />
              <p className="m-0">還沒有庫位，請先建立第一個。</p>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-[10px] px-5 pb-5 max-lg:grid-cols-1 [&_article]:flex [&_article]:items-center [&_article]:gap-3 [&_article]:rounded-lg [&_article]:border [&_article]:border-[var(--color-line)] [&_article]:p-3 [&_article>span]:grid [&_article>span]:h-9 [&_article>span]:w-9 [&_article>span]:place-items-center [&_article>span]:rounded-lg [&_article>span]:bg-[var(--color-accent-soft)] [&_article>span]:text-[var(--color-rust)] [&_article>span_svg]:w-[18px] [&_article>div]:min-w-0 [&_article>div]:flex-1 [&_article>div_code]:text-[14px] [&_article>div_small]:mt-1 [&_article>div_small]:block [&_article>div_small]:text-[10px] [&_article>div_small]:text-[var(--color-muted)] [&_article>b]:text-right [&_article>b]:font-mono [&_article>b]:text-[18px] [&_article>b]:font-medium [&_article>b_small]:block [&_article>b_small]:font-sans [&_article>b_small]:text-[10px] [&_article>b_small]:text-[var(--color-muted)]">
            {locations.map((item) => (
              <article key={item.id}>
                <span>
                  <MapPin />
                </span>
                <div>
                  <code>{item.code}</code>
                  <small>
                    {item.description ||
                      `${item.cabinet} 櫃 · 第 ${item.shelf} 層 · 第 ${item.bin} 格`}
                  </small>
                </div>
                <b>
                  {item.count}
                  <small>項商品</small>
                </b>
              </article>
            ))}
          </div>
        </DataState>
      </section>
    </div>
  );
}
