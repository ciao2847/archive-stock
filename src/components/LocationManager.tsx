"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, MapPin, Plus, Warehouse } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { LOCATION_CODE_PATTERN } from "@/constants";
import { DEFAULT_VALUES } from "@/constants";
import { DataState } from "./DataState";
import { FormInput, FormLabel, FormPrimaryButton } from "./FormControls";

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
      rows?.map((row) => ({
        ...row,
        count: counts.get(row.id) ?? DEFAULT_VALUES.count,
      })) ?? [],
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
      <section className="card h-max">
        <div className="card-head">
          <div>
            <h2>建立新庫位</h2>
            <p>格式：櫃－層－格，例如 A-03-02</p>
          </div>
        </div>
        <form className="px-6 pb-6" onSubmit={addLocation}>
          <FormLabel>
            庫位代碼
            <FormInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="A-03-02"
              required
            />
          </FormLabel>
          <FormLabel>
            說明（選填）
            <FormInput
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A 櫃第三層第二格"
            />
          </FormLabel>
          {error && <div className="login-error">{error}</div>}
          <FormPrimaryButton disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Plus />}
            {saving ? "建立中…" : "新增庫位"}
          </FormPrimaryButton>
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
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 max-lg:grid-cols-1">
            {locations?.map((item) => (
              <LocationCard item={item} key={item.id} />
            ))}
          </div>
        </DataState>
      </section>
    </div>
  );
}

function LocationCard({ item }: { item: LocationRow }) {
  return (
    <article className="flex items-center gap-3 rounded-lg border border-line p-3">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-rust">
        <MapPin className="w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <code className="text-[14px]">{item.code}</code>
        <small className="mt-1 block text-[10px] text-muted">
          {item.description ||
            `${item.cabinet} 櫃 · 第 ${item.shelf} 層 · 第 ${item.bin} 格`}
        </small>
      </div>
      <b className="text-right font-mono text-[18px] font-medium">
        {item.count}
        <small className="block font-sans text-[10px] text-muted">項商品</small>
      </b>
    </article>
  );
}
