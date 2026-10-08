"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, Minus, X, Image as ImageIcon } from "lucide-react";
import { getStorage, manageStorage } from "@/lib/api/locations";
import {
  slotTotals,
  unassignedQuantity,
  type StorageAction,
  type StorageCabinet,
  type StorageData,
  type StoredProduct,
} from "@/lib/location-storage";
import { COUNTRIES } from "@/constants";
const StorageFeedback = createContext("");
const money = (n: number) => `NT$ ${n.toLocaleString("zh-TW")}`;
export function LocationManager({
  ownerId,
  query = "",
}: {
  ownerId: string;
  query?: string;
}) {
  return <StorageWorkspace key={ownerId} ownerId={ownerId} query={query} />;
}
function StorageWorkspace({
  ownerId,
  query,
}: {
  ownerId: string;
  query: string;
}) {
  const client = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryKey: ["location-storage", ownerId],
    queryFn: ({ signal }) => getStorage(ownerId, signal),
    retry: false,
  });
  const [selected, setSelected] = useState("");
  const [cabinetId, setCabinetId] = useState("");
  const activeCabinet =
    data?.cabinets.find((c) => c.id === cabinetId) ?? data?.cabinets[0];
  const [locked, setLocked] = useState(true);
  const [lockedId, setLockedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [cabinetEditor, setCabinetEditor] = useState<
    StorageCabinet | null | undefined
  >();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [batch, setBatch] = useState<{
    source?: string;
    productId?: string;
  } | null>(null);
  useEffect(() => {
    if (
      data &&
      !data.slots.some(
        (s) => s.id === selected && s.cabinet_id === activeCabinet?.id,
      )
    )
      setSelected(
        data.slots.find((s) => s.cabinet_id === activeCabinet?.id)?.id ?? "",
      );
  }, [data, selected, activeCabinet?.id]);
  useEffect(() => {
    if (locked && data && !data.slots.some((s) => s.id === lockedId))
      setLockedId(selected);
  }, [locked, data, lockedId, selected]);
  function switchCabinet(cabinet: StorageCabinet, storage = data) {
    setCabinetId(cabinet.id);
    setSelected(
      storage?.slots.find((s) => s.cabinet_id === cabinet.id)?.id ?? "",
    );
    setLocked(false);
    setLockedId("");
    setBatch(null);
    setFailure("");
    setMessage("");
  }
  async function execute(action: StorageAction) {
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      await manageStorage(ownerId, action);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["location-storage", ownerId] }),
        client.invalidateQueries({ queryKey: ["products"] }),
        client.invalidateQueries({ queryKey: ["account"] }),
      ]);
      if (action.action === "create_cabinet") {
        const updated = client.getQueryData<StorageData>([
          "location-storage",
          ownerId,
        ]);
        const created = updated?.cabinets.find(
          (c) => !data?.cabinets.some((existing) => existing.id === c.id),
        );
        if (created) switchCabinet(created, updated);
      }
      setMessage("已儲存");
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "儲存失敗");
      await client.invalidateQueries({
        queryKey: ["location-storage", ownerId],
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (isPending)
    return (
      <div className="card p-8">
        <LoaderCircle className="animate-spin" />
        正在讀取庫位…
      </div>
    );
  if (error || !data)
    return (
      <div className="data-error" role="alert">
        {error?.message ?? "庫位載入失敗"}
      </div>
    );
  const slot = data.slots.find((s) => s.id === selected);
  const totals = slotTotals(data.products, selected);
  const pending = data.products.filter((p) => unassignedQuantity(p) > 0);
  const term = query.trim().toLowerCase();
  const cabinetSlots = data.slots.filter(
    (s) => s.cabinet_id === activeCabinet?.id,
  );
  return (
    <StorageFeedback.Provider value={failure}>
      <div className="storage-workspace">
        {failure && (
          <div className="data-error storage-notice" role="alert">
            {failure}
          </div>
        )}
        {message && (
          <p className="storage-notice text-secondary-strong" role="status">
            {message}
          </p>
        )}
        <div className="storage-main">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">我的櫃子</h2>
              <button
                className="outline"
                disabled={busy}
                onClick={() => setCabinetEditor(null)}
              >
                <Plus size={16} />
                新增櫃子
              </button>
            </div>
            {data.cabinets.length === 0 && (
              <section className="card p-8 text-center text-muted">
                先建立櫃子，設定排數與每排格數。
              </section>
            )}
            {data.cabinets.length > 0 && (
              <div
                className="storage-cabinet-tabs"
                role="tablist"
                aria-label="櫃子"
              >
                {data.cabinets.map((c, i) => (
                  <button
                    type="button"
                    role="tab"
                    id={`cabinet-tab-${c.id}`}
                    aria-controls={`cabinet-panel-${c.id}`}
                    aria-selected={activeCabinet?.id === c.id}
                    tabIndex={activeCabinet?.id === c.id ? 0 : -1}
                    title={c.name}
                    disabled={busy}
                    onClick={() => switchCabinet(c)}
                    onKeyDown={(e) => {
                      if (
                        !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                          e.key,
                        )
                      )
                        return;
                      e.preventDefault();
                      const index =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? data.cabinets.length - 1
                            : (i +
                                (e.key === "ArrowRight" ? 1 : -1) +
                                data.cabinets.length) %
                              data.cabinets.length;
                      const next = data.cabinets[index];
                      switchCabinet(next);
                      document
                        .getElementById(`cabinet-tab-${next.id}`)
                        ?.focus();
                    }}
                    key={c.id}
                  >
                    {c.code} 櫃
                  </button>
                ))}
              </div>
            )}
            {data.cabinets
              .filter((c) => c.id === activeCabinet?.id)
              .map((c) => {
                const slots = data.slots.filter((s) => s.cabinet_id === c.id);
                const occupiedCells = new Set(
                  slots.map((s) => `${s.shelf}-${s.bin}`),
                );
                const missingCells = Array.from(
                  { length: c.rows * c.columns },
                  (_, i) => ({
                    row: Math.floor(i / c.columns) + 1,
                    column: (i % c.columns) + 1,
                  }),
                ).filter(
                  ({ row, column }) => !occupiedCells.has(`${row}-${column}`),
                );
                return (
                  <section
                    className={`card storage-cabinet ${c.rows > 5 ? "is-short" : ""}`}
                    id={`cabinet-panel-${c.id}`}
                    role="tabpanel"
                    aria-labelledby={`cabinet-tab-${c.id}`}
                    key={c.id}
                  >
                    <header className="storage-card-head storage-cabinet-head">
                      <div>
                        <h2>
                          {c.code} 櫃 · {c.name}
                        </h2>
                        <p>
                          {c.rows} 排 × {c.columns} 格 ·{" "}
                          {slots.length === 0
                            ? "尚未設定格位（留空待安排）"
                            : missingCells.length
                              ? `已建立 ${slots.length} 個庫位`
                              : `共 ${slots.length} 個庫位`}
                        </p>
                      </div>
                      <div className="storage-cabinet-controls">
                        <button
                          className="outline"
                          disabled={busy}
                          onClick={() => setCabinetEditor(c)}
                        >
                          調整格數
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void execute({ action: "add_slot", id: c.id })
                          }
                        >
                          {missingCells.length ? "補齊格位" : "增加一欄"}
                        </button>
                      </div>
                    </header>
                    <div className="storage-grid-area">
                      <p className="storage-grid-hint">
                        選擇格位查看海報；小格顯示排／格編號，完整資訊顯示於詳情面板。
                      </p>
                      <div
                        className="storage-cabinet-board"
                        role="region"
                        aria-label={`${c.name}格位`}
                      >
                        <div
                          className="storage-slot-grid"
                          style={
                            {
                              "--slot-columns": c.columns,
                              "--slot-rows": c.rows,
                            } as React.CSSProperties
                          }
                        >
                          {slots.map((s) => {
                            const count = slotTotals(data.products, s.id);
                            const matches =
                              !term ||
                              `${s.display_name} ${s.code} ${c.name}`
                                .toLowerCase()
                                .includes(term);
                            return (
                              <article
                                key={s.id}
                                className={`storage-slot ${count.quantity === 0 ? "is-available" : ""} ${s.id === selected ? "is-selected" : ""} ${locked && s.id === lockedId ? "is-locked" : ""} ${matches ? "" : "is-muted"}`}
                                style={{
                                  gridRow: s.shelf ?? undefined,
                                  gridColumn: s.bin ?? undefined,
                                }}
                              >
                                <button
                                  className="storage-slot-select"
                                  aria-pressed={s.id === selected}
                                  aria-label={`${s.display_name ?? s.code} ${count.quantity > 0 ? `${count.count} 款 · ${count.quantity} 張` : "可用"}`}
                                  title={`${s.code} · ${s.display_name ?? s.code}`}
                                  onClick={() => setSelected(s.id)}
                                >
                                  <span className="storage-cell-full">
                                    <b>{s.display_name ?? s.code}</b>
                                    <small>
                                      {count.quantity > 0
                                        ? `${count.count} 款 · ${count.quantity} 張`
                                        : "可用"}
                                    </small>
                                  </span>
                                  <span
                                    className="storage-cell-compact"
                                    aria-hidden="true"
                                  >
                                    <b>
                                      {s.shelf}-{s.bin}
                                    </b>
                                    <small>
                                      {count.quantity > 0
                                        ? `${count.quantity}張`
                                        : "空"}
                                    </small>
                                  </span>
                                </button>
                              </article>
                            );
                          })}
                          {missingCells.map(({ row, column }) => (
                            <div
                              key={`missing-${row}-${column}`}
                              className="storage-slot storage-slot-missing"
                              style={{ gridRow: row, gridColumn: column }}
                              aria-label={`第 ${row} 排第 ${column} 格尚未建立`}
                            >
                              <div className="storage-slot-select">
                                <span className="storage-cell-full">
                                  <b>尚未建格</b>
                                  <small>
                                    {row} 排 · {column} 格
                                  </small>
                                </span>
                                <span
                                  className="storage-cell-compact"
                                  aria-hidden="true"
                                >
                                  <b>
                                    {row}-{column}
                                  </b>
                                  <small>未建立</small>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      {missingCells.length > 0 && (
                        <p className="storage-missing-hint">
                          有 {missingCells.length}{" "}
                          格尚未建立，可用「補齊格位」一次建立。
                        </p>
                      )}
                      {term &&
                        slots.every(
                          (s) =>
                            !`${s.display_name} ${s.code} ${c.name}`
                              .toLowerCase()
                              .includes(term),
                        ) && (
                          <p className="text-sm text-muted">
                            找不到符合搜尋的格位
                          </p>
                        )}
                      <p className="storage-legend">
                        <span>
                          <i
                            className="storage-legend-selected"
                            aria-hidden="true"
                          />
                          目前選取
                        </span>
                        <span>
                          <i
                            className="storage-legend-available"
                            aria-hidden="true"
                          />
                          可用庫位
                        </span>
                        <span>
                          <i
                            className="storage-legend-locked"
                            aria-hidden="true"
                          />
                          鎖定快速建檔庫位
                        </span>
                      </p>
                    </div>
                  </section>
                );
              })}
            <section className="card storage-pending">
              <header className="storage-card-head">
                <div>
                  <h2>
                    待整理海報{" "}
                    <span className="storage-count">
                      {pending.length} 款
                      {pending.length > 0
                        ? ` · 共 ${pending.reduce((sum, p) => sum + unassignedQuantity(p), 0)} 張`
                        : ""}
                    </span>
                  </h2>
                  <p>已建檔、尚未放入庫位的海報</p>
                </div>
              </header>
              <div className="storage-product-list">
                {pending.length ? (
                  pending.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      quantity={unassignedQuantity(p)}
                      action={
                        <button
                          className="primary"
                          disabled={!slot || busy}
                          onClick={() => setBatch({ productId: p.id })}
                        >
                          放入庫位
                        </button>
                      }
                    />
                  ))
                ) : (
                  <p className="storage-empty">沒有待整理海報</p>
                )}
              </div>
            </section>
          </div>
          <div className="space-y-5">
            <section className="card">
              <header className="storage-card-head">
                <div>
                  <h2>
                    {activeCabinet?.code} 櫃 /{" "}
                    {slot?.display_name ?? slot?.code ?? "尚未選擇庫位"}
                  </h2>
                  <p>
                    {slot
                      ? `${totals.count} 款海報 · 共 ${totals.quantity} 張`
                      : "請點選左側格位查看明細，或於下方檢視待整理海報"}
                  </p>
                </div>
                {slot && (
                  <div className="storage-detail-tools">
                    <button
                      className="outline"
                      aria-label={`編輯 ${slot.display_name ?? slot.code}`}
                      disabled={busy}
                      onClick={() => {
                        setRenameId(slot.id);
                        setRename(slot.display_name ?? slot.code);
                      }}
                    >
                      編輯
                    </button>
                    <button
                      className="outline"
                      aria-label={`刪除 ${slot.display_name ?? slot.code}`}
                      disabled={busy}
                      onClick={() => setDeleting(slot.id)}
                    >
                      刪除
                    </button>
                  </div>
                )}
              </header>
              <div className="storage-product-list">
                {totals.items.length ? (
                  totals.items.map(({ product, quantity }) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      quantity={quantity}
                      action={
                        <button
                          className="outline"
                          disabled={busy || data.slots.length < 2}
                          onClick={() =>
                            setBatch({
                              source: selected,
                              productId: product.id,
                            })
                          }
                        >
                          搬移
                        </button>
                      }
                    />
                  ))
                ) : !slot ? (
                  <p className="storage-empty">
                    尚未選擇庫位
                    <br />
                    請先在左側選取格位或建立格位
                  </p>
                ) : (
                  <p className="storage-empty">
                    這個庫位還沒有海報
                    <br />
                    點選下方「批次放入海報」開始整理
                  </p>
                )}
              </div>
              <footer className="storage-card-actions">
                <button
                  className="primary"
                  disabled={!slot || busy || pending.length === 0}
                  onClick={() => setBatch({})}
                >
                  <Plus size={16} />
                  批次放入海報
                </button>
                <label className="storage-lock">
                  <input
                    type="checkbox"
                    checked={locked}
                    onChange={(e) => {
                      setLocked(e.target.checked);
                      if (e.target.checked) setLockedId(selected);
                    }}
                  />
                  鎖定建檔庫位
                </label>
              </footer>
            </section>
            <QuickAdd
              data={{ ...data, slots: cabinetSlots }}
              cabinetId={activeCabinet?.id ?? ""}
              selected={locked ? lockedId || selected : selected}
              locked={locked}
              busy={busy}
              onSave={execute}
            />
          </div>
        </div>
        {cabinetEditor !== undefined && (
          <CabinetEditor
            cabinet={cabinetEditor}
            busy={busy}
            onClose={() => setCabinetEditor(undefined)}
            onSave={async (action) => {
              if (await execute(action)) setCabinetEditor(undefined);
            }}
          />
        )}
        {renameId && (
          <StorageDialog
            title="編輯格位名稱"
            busy={busy}
            onClose={() => setRenameId(null)}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await execute({
                    action: "rename_slot",
                    id: renameId,
                    name: rename,
                  })
                )
                  setRenameId(null);
              }}
            >
              <label className="field">
                <span>名稱</span>
                <input
                  required
                  maxLength={100}
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                  autoFocus
                />
              </label>
              <button className="primary mt-5 w-full" disabled={busy}>
                儲存名稱
              </button>
            </form>
          </StorageDialog>
        )}
        {deleting && (
          <StorageDialog
            title="刪除格位"
            busy={busy}
            onClose={() => setDeleting(null)}
          >
            <p className="text-sm text-muted">
              有海報或歷史紀錄的格位會保留，請先搬移海報。
            </p>
            <button
              className="primary mt-5 w-full"
              disabled={busy}
              onClick={async () => {
                if (await execute({ action: "delete_slot", id: deleting }))
                  setDeleting(null);
              }}
            >
              確認刪除空格位
            </button>
          </StorageDialog>
        )}
        {batch && slot && (
          <BatchPutaway
            data={data}
            targetId={selected}
            source={batch.source}
            initialId={batch.productId}
            busy={busy}
            onClose={() => setBatch(null)}
            onSave={async (action) => {
              if (await execute(action)) setBatch(null);
            }}
          />
        )}
      </div>
    </StorageFeedback.Provider>
  );
}
function ProductRow({
  product,
  quantity,
  action,
}: {
  product: StoredProduct;
  quantity: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="storage-product-row">
      <Thumbnail product={product} />
      <div className="storage-product-info min-w-0 flex-1">
        <b className="block break-words text-sm">{product.name}</b>
        <small className="text-muted">
          {product.country || "未指定"} · {money(product.price)}
        </small>
      </div>
      <span className="storage-product-quantity whitespace-nowrap">
        <b>{quantity}</b> <small className="text-muted">張</small>
      </span>
      {action}
    </div>
  );
}
function Thumbnail({ product }: { product: StoredProduct }) {
  return (
    <div className="storage-thumbnail">
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image} alt={product.name} />
      ) : (
        <ImageIcon size={24} className="text-muted" />
      )}
    </div>
  );
}
function StorageDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogError = useContext(StorageFeedback);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="storage-modal-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        className="card storage-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Tab") {
            const nodes = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
              ),
            );
            const first = nodes[0],
              last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="storage-card-head">
          <h2>{title}</h2>
          <button
            type="button"
            ref={closeRef}
            className="icon-btn"
            disabled={busy}
            onClick={onClose}
            aria-label="關閉"
          >
            <X size={20} />
          </button>
        </header>
        <div className="storage-modal-body">
          {dialogError && (
            <div className="data-error mb-4" role="alert">
              {dialogError}
            </div>
          )}
          {children}
        </div>
      </section>
    </div>
  );
}
function CabinetEditor({
  cabinet,
  busy,
  onClose,
  onSave,
}: {
  cabinet: StorageCabinet | null;
  busy: boolean;
  onClose: () => void;
  onSave: (action: StorageAction) => Promise<void>;
}) {
  const [name, setName] = useState(cabinet?.name ?? "海報櫃");
  const [rows, setRows] = useState(cabinet?.rows ?? 3);
  const [columns, setColumns] = useState(cabinet?.columns ?? 5);
  return (
    <StorageDialog
      title={cabinet ? "調整櫃子" : "新增櫃子"}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(
            cabinet
              ? {
                  action: "resize_cabinet",
                  id: cabinet.id,
                  name,
                  rows,
                  columns,
                }
              : { action: "create_cabinet", name, rows, columns },
          );
        }}
      >
        <label className="field">
          <span>櫃子名稱</span>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>排數</span>
            <input
              type="number"
              min={1}
              max={99}
              required
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>每排格數</span>
            <input
              type="number"
              min={1}
              max={99}
              required
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="text-sm text-muted">
          共 {rows * columns} 格。有海報的格位不能縮減。
        </p>
        <button className="primary w-full" disabled={busy}>
          儲存櫃子
        </button>
      </form>
    </StorageDialog>
  );
}
function QuickAdd({
  data,
  cabinetId,
  selected,
  locked,
  busy,
  onSave,
}: {
  data: StorageData;
  cabinetId: string;
  selected: string;
  locked: boolean;
  busy: boolean;
  onSave: (action: StorageAction) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string>(COUNTRIES[0]);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [destination, setDestination] = useState({ cabinetId, id: selected });
  const requested =
    destination.cabinetId === cabinetId ? destination.id : selected;
  const target = locked
    ? selected
    : requested && !data.slots.some((s) => s.id === requested)
      ? selected
      : requested;
  const nameRef = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const ok = await onSave({
      action: "quick_add",
      name,
      country,
      price: Number(price),
      quantity,
      locationId: target || null,
    });
    if (ok) {
      setName("");
      setQuantity(1);
      if (!locked) setDestination({ cabinetId, id: "" });
      nameRef.current?.focus();
    }
  }
  return (
    <section className="card">
      <header className="storage-card-head">
        <div>
          <h2>拆箱快速建檔</h2>
          <p>連續登記新到貨，Enter 快速儲存</p>
        </div>
        <span className="storage-count">QUICK ADD</span>
      </header>
      <form className="storage-quick-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>名稱 *</span>
          <input
            ref={nameRef}
            required
            maxLength={300}
            placeholder="例如：寄生上流 韓版原裝款"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>國家版本</span>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={busy}
            >
              {COUNTRIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>販售金額 NT$ *</span>
            <input
              type="number"
              required
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>到貨數量 *</span>
            <input
              type="number"
              min={1}
              max={1000}
              required
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>存放庫位</span>
            <select
              value={target}
              onChange={(e) =>
                setDestination({ cabinetId, id: e.target.value })
              }
              disabled={busy || locked}
            >
              <option value="">待整理（稍後安排）</option>
              {data.slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {data.cabinets.find((c) => c.id === s.cabinet_id)?.name}／
                  {s.display_name ?? s.code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="primary w-full" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" size={16} /> : null}
          儲存並建立下一筆 ↵
        </button>
        <p className="text-xs text-muted">
          圖片可於「新增海報」上傳，或在海報清單中補上。
        </p>
      </form>
    </section>
  );
}
function BatchPutaway({
  data,
  targetId,
  source,
  initialId,
  busy,
  onClose,
  onSave,
}: {
  data: StorageData;
  targetId: string;
  source?: string;
  initialId?: string;
  busy: boolean;
  onClose: () => void;
  onSave: (action: StorageAction) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState(
    source ? (data.slots.find((s) => s.id !== source)?.id ?? "") : targetId,
  );
  const candidates = data.products
    .map((product) => ({
      product,
      max: source
        ? (product.allocations.find((a) => a.location_id === source)
            ?.quantity ?? 0)
        : unassignedQuantity(product),
    }))
    .filter((p) => p.max > 0);
  const [selected, setSelected] = useState<Record<string, number>>(() =>
    initialId
      ? {
          [initialId]:
            candidates.find((p) => p.product.id === initialId)?.max ?? 1,
        }
      : {},
  );
  const visible = candidates.filter(({ product }) =>
    `${product.name} ${product.country}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const chosen = candidates.filter(({ product }) => selected[product.id]);
  const count = chosen.reduce(
    (sum, { product, max }) => sum + Math.min(selected[product.id], max),
    0,
  );
  const name = data.slots.find((s) => s.id === target)?.display_name ?? "庫位";
  return (
    <StorageDialog
      title={`${source ? "搬移海報" : "批次放入"}：${name}`}
      busy={busy}
      onClose={onClose}
    >
      <p className="text-xs text-muted">
        未分配庫存放入此格；已入庫海報請使用「搬移」，避免重複計算。
      </p>
      {source && (
        <label className="field mt-4">
          <span>搬移至</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {data.slots
              .filter((s) => s.id !== source)
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.display_name ?? s.code}
                </option>
              ))}
          </select>
        </label>
      )}
      <input
        className="storage-search"
        type="search"
        aria-label="搜尋待放入海報"
        placeholder="搜尋海報名稱或國家…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={busy || visible.length === 0}
          checked={
            visible.length > 0 &&
            visible.every(({ product }) => Boolean(selected[product.id]))
          }
          onChange={(e) =>
            setSelected((current) => {
              const next = { ...current };
              for (const { product, max } of visible) {
                if (e.target.checked) next[product.id] = max;
                else delete next[product.id];
              }
              return next;
            })
          }
        />
        全選目前清單
      </label>
      <div className="storage-batch-list">
        {visible.map(({ product, max }) => (
          <div className="storage-batch-row" key={product.id}>
            <input
              type="checkbox"
              aria-label={`選擇 ${product.name}`}
              disabled={busy}
              checked={Boolean(selected[product.id])}
              onChange={(e) =>
                setSelected((current) => {
                  const next = { ...current };
                  if (e.target.checked) next[product.id] = max;
                  else delete next[product.id];
                  return next;
                })
              }
            />
            <Thumbnail product={product} />
            <div className="min-w-0 flex-1">
              <b className="text-sm">{product.name}</b>
              <small className="block text-xs text-muted">
                {product.country} · {money(product.price)}
              </small>
            </div>
            <div className="storage-batch-quantity">
              <small>可放入 {max} 張</small>
              <div className="storage-stepper">
                <button
                  aria-label={`減少 ${product.name} 數量`}
                  disabled={
                    busy || !selected[product.id] || selected[product.id] <= 1
                  }
                  onClick={() =>
                    setSelected((current) => ({
                      ...current,
                      [product.id]: current[product.id] - 1,
                    }))
                  }
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  aria-label={`${product.name} 放入數量`}
                  min={1}
                  max={max}
                  disabled={busy || !selected[product.id]}
                  value={selected[product.id] ?? max}
                  onChange={(e) =>
                    setSelected((current) => ({
                      ...current,
                      [product.id]: Math.max(
                        1,
                        Math.min(max, Math.floor(Number(e.target.value) || 1)),
                      ),
                    }))
                  }
                />
                <button
                  aria-label={`增加 ${product.name} 數量`}
                  disabled={
                    busy || !selected[product.id] || selected[product.id] >= max
                  }
                  onClick={() =>
                    setSelected((current) => ({
                      ...current,
                      [product.id]: current[product.id] + 1,
                    }))
                  }
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <footer className="storage-batch-footer">
        <b>
          已選擇 {chosen.length} 款 · 共 {count} 張
        </b>
        <div className="flex gap-2">
          <button className="outline" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !chosen.length || !target}
            onClick={() =>
              void onSave({
                action: "putaway",
                locationId: target,
                items: chosen.map(({ product, max }) => ({
                  productId: product.id,
                  quantity: Math.min(selected[product.id], max),
                  ...(source ? { fromLocationId: source } : {}),
                })),
              })
            }
          >
            {busy ? "儲存中…" : source ? "確認搬移" : "確認放入庫位"}
          </button>
        </div>
      </footer>
    </StorageDialog>
  );
}
