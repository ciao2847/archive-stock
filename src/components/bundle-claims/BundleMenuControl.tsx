"use client";

import { useEffect, useRef, useState } from "react";
import { AvailabilitySwitch } from "@/components/order-management/AvailabilitySwitch";
import {
  Check,
  Clipboard,
  ExternalLink,
  Layers,
  LoaderCircle,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import {
  createBundleCampaign,
  fetchBundleCampaigns,
  updateBundleCampaign,
} from "@/lib/api/bundle-claims";
import type { BundleClaimCampaign } from "@/lib/bundle-claims";

export function BundleMenuControl({
  ownerId,
  refreshKey,
  selectedCampaignId,
  onSelectCampaign,
  onCampaignsChange,
}: {
  ownerId: string;
  refreshKey: number;
  selectedCampaignId: number | "all";
  onSelectCampaign: (id: number | "all") => void;
  onCampaignsChange: (campaigns: BundleClaimCampaign[]) => void;
}) {
  const [campaigns, setCampaigns] = useState<BundleClaimCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] =
    useState<BundleClaimCampaign | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const alive = useRef(true);
  const selectedRef = useRef(selectedCampaignId);
  const loaded = useRef(false);
  useEffect(() => {
    selectedRef.current = selectedCampaignId;
  }, [selectedCampaignId]);
  const activeCampaign = campaigns.find(
    (campaign) => campaign.id === selectedCampaignId,
  );

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setLoading(true);
    fetchBundleCampaigns(ownerId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCampaigns(result.campaigns);
        onCampaignsChange(result.campaigns);
        if (
          !loaded.current ||
          (selectedRef.current !== "all" &&
            !result.campaigns.some(
              (campaign) => campaign.id === selectedRef.current,
            ))
        ) {
          onSelectCampaign(result.campaigns[0]?.id ?? "all");
        }
        loaded.current = true;
        setError("");
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "讀取活動失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [ownerId, refreshKey, onCampaignsChange, onSelectCampaign]);
  useEffect(() => {
    setCopied(false);
  }, [selectedCampaignId]);

  function replaceCampaign(campaign: BundleClaimCampaign) {
    const next = campaigns.some((current) => current.id === campaign.id)
      ? campaigns.map((current) =>
          current.id === campaign.id ? { ...current, ...campaign } : current,
        )
      : [{ ...campaign, orderCount: 0 }, ...campaigns];
    setCampaigns(next);
    onCampaignsChange(next);
  }
  function openModal(campaign: BundleClaimCampaign | null) {
    setEditingCampaign(campaign);
    setTitle(campaign?.title ?? "");
    setDescription(campaign?.description ?? "");
    setError("");
    setModalOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = editingCampaign
        ? await updateBundleCampaign({
            ownerId,
            id: editingCampaign.id,
            title: title.trim(),
            description: description.trim(),
          })
        : await createBundleCampaign({
            ownerId,
            title: title.trim(),
            description: description.trim(),
            enabled: false,
          });
      if (!alive.current) return;
      replaceCampaign(result.campaign);
      onSelectCampaign(result.campaign.id);
      setModalOpen(false);
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : "儲存活動失敗");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function toggle(campaign: BundleClaimCampaign) {
    if (busy || loading) return;
    if (
      campaign.enabled &&
      !window.confirm(
        `確定暫停「${campaign.title}」？客人將無法查看活動選單或送出確認，既有配單紀錄會保留。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await updateBundleCampaign({
        ownerId,
        id: campaign.id,
        enabled: !campaign.enabled,
      });
      if (alive.current) replaceCampaign(result.campaign);
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : "更新活動失敗");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function copy(campaign: BundleClaimCampaign) {
    const url = `${window.location.origin}/bundles/${campaign.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      if (alive.current) setCopied(true);
    } catch {
      if (alive.current) window.prompt("請複製活動共同連結", url);
    }
  }
  return (
    <>
      <div className="bundle-campaign-layout">
        <section className="card bundle-campaign-picker">
          <div className="bundle-campaign-picker-fields">
            <label className="bundle-campaign-label text-dark">
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <Layers size={17} className="text-primary" />
                配單活動
              </span>
              <select
                className="min-h-11 min-w-0 max-w-full flex-[1_1_240px] rounded-[8px] border border-line bg-white px-3 text-[13px] font-medium"
                value={selectedCampaignId}
                onChange={(event) =>
                  onSelectCampaign(
                    event.target.value === "all"
                      ? "all"
                      : Number(event.target.value),
                  )
                }
                disabled={loading || busy}
              >
                <option value="all">全部配單活動</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.title}（{campaign.enabled ? "開放中" : "已暫停"}）
                    · {campaign.orderCount ?? 0} 份
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="outline"
              onClick={() => openModal(null)}
              disabled={loading || busy}
            >
              <Plus size={15} />
              建立新配單活動
            </button>
          </div>
          {/* <p className="bundle-campaign-help text-muted">
            每個活動有自己的共同連結。同一批客人從該連結點選自己的姓名，核對商品與金額後送出確認。
          </p> */}
          {error && (
            <p className="mb-0 mt-3 text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}
        </section>
        {activeCampaign ? (
          <section className="card bundle-campaign-public">
            <div className="bundle-campaign-public-header">
              <div className="flex gap-1 min-w-0">
                <h3 className="m-0 break-words text-[16px] font-bold">
                  {activeCampaign.title}
                </h3>
                 <button
                  type="button"
                  disabled={busy}
                  onClick={() => openModal(activeCampaign)}
                >
                  <Pencil size={14} />
                </button>
                {/* <p
                  className={`mb-0 mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${activeCampaign.enabled ? "bg-primary-soft text-primary" : "bg-light text-muted"}`}
                >
                  {activeCampaign.enabled ? "選單開放中" : "選單已暫停"}
                </p> */}
                {activeCampaign.description && (
                  <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted">
                    {activeCampaign.description}
                  </p>
                )}
                 <div className="bundle-campaign-edit">
               
              </div>
              </div>
         
            </div>
            <div className="bundle-campaign-availability">
              <AvailabilitySwitch
                label="公開配單選單"
                enabled={activeCampaign.enabled}
                busy={busy}
                disabled={loading}
                enabledText="已開放"
                description="暫停後客人無法查看選單或送出確認，既有配單紀錄會保留。"
                onToggle={() => void toggle(activeCampaign)}
              />
            </div>
            <div className="bundle-campaign-link">
              <code className="min-w-0 flex-[1_1_100%] break-all text-[11px] text-dark">
                /bundles/{activeCampaign.publicToken}
              </code>
              <button
                type="button"
                className="outline"
                disabled={busy}
                onClick={() => void copy(activeCampaign)}
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}{" "}
                {copied ? "已複製" : "複製活動共同連結"}
              </button>
              {activeCampaign.enabled && (
                <a
                  className="outline"
                  href={`/bundles/${activeCampaign.publicToken}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  預覽活動選單
                </a>
              )}
              {!activeCampaign.enabled && (
                <span className="text-[11px] text-muted">
                  開放活動後，客人才能查看及送出。
                </span>
              )}
            </div>
          </section>
        ) : (
          !loading && (
            <p className="mb-0 mt-3 text-[12px] text-muted">
              {campaigns.length
                ? "目前顯示全部活動；選擇一個活動即可管理並複製它的共同連結。"
                : "請先建立配單活動，再新增客人的姓名選項。"}
            </p>
          )
        )}
      </div>
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bundle-campaign-dialog-title"
            className="max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-[14px] bg-white p-5 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) setModalOpen(false);
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="bundle-campaign-dialog-title"
                className="m-0 text-[17px] font-bold"
              >
                {editingCampaign ? "編輯配單活動" : "建立新配單活動"}
              </h3>
              <button
                type="button"
                aria-label="關閉活動編輯"
                disabled={busy}
                onClick={() => setModalOpen(false)}
                className="grid size-8 place-items-center"
              >
                <X size={18} />
              </button>
            </div>
            <form className="mt-4 space-y-4" onSubmit={save}>
              <label className="block text-[13px] font-semibold">
                活動名稱 <em className="not-italic text-danger">*</em>
                <input
                  className="mt-2 min-h-11 w-full rounded-[8px] border border-line px-3 text-[14px]"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                  disabled={busy}
                />
              </label>
              <label className="block text-[13px] font-semibold">
                活動說明（選填）
                <textarea
                  className="mt-2 min-h-24 w-full resize-y rounded-[8px] border border-line p-3 text-[13px]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              {!editingCampaign && (
                <p className="m-0 text-[12px] text-muted">
                  新活動先保持暫停；整理姓名與商品後再開放。
                </p>
              )}
              {error && (
                <p role="alert" className="text-[12px] text-danger">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="outline"
                  onClick={() => setModalOpen(false)}
                  disabled={busy}
                >
                  取消
                </button>
                <button type="submit" className="primary" disabled={busy}>
                  {busy && <LoaderCircle size={14} className="animate-spin" />}
                  {editingCampaign ? "儲存修改" : "建立活動"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
