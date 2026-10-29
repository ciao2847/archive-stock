"use client";

import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { CloseButton } from "@/components/ui/CloseButton";
import { Spinner } from "@/components/ui/Spinner";

import { useEffect, useRef, useState } from "react";
import { AvailabilitySwitch } from "@/components/order-management/AvailabilitySwitch";
import {
  Check,
  Clipboard,
  ExternalLink,
  Layers,
  Pencil,
  Plus,
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
      <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:items-stretch">
        <section className="card min-w-0 rounded-[20px]! p-6 [@media(max-width:380px)]:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="grid min-w-0 gap-4 text-[16px] font-bold text-dark">
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <Layers size={17} className="text-primary" />
                配單活動
              </span>
              <select
                className="min-h-12 w-full min-w-0 max-w-full flex-[1_1_240px] rounded-[12px] border border-line bg-white p-3 text-[15px] font-medium lg:min-h-10 lg:p-2.5 lg:text-[13px]"
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
              className="outline min-h-12 w-full rounded-[12px]! lg:min-h-10 lg:px-3! lg:py-2.5! lg:text-[12px]"
              onClick={() => openModal(null)}
              disabled={loading || busy}
            >
              <Plus size={15} />
              建立新配單活動
            </button>
          </div>
          {error && (
            <ErrorMessage className="mb-0 mt-3 text-[13px] text-danger">
              {error}
            </ErrorMessage>
          )}
        </section>
        {activeCampaign ? (
          <section className="card min-w-0 rounded-[20px]! p-6 [@media(max-width:380px)]:p-5 lg:relative">
            <div className="flex items-start justify-between gap-4 lg:pr-[94px]">
              <div className="flex gap-1 min-w-0">
                <h3 className="m-0 break-words text-[18px] font-bold leading-normal">
                  {activeCampaign.title}
                </h3>
                <button
                  type="button"
                  aria-label="編輯活動"
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
              </div>
            </div>
            <div className="mt-4 lg:absolute lg:right-6 lg:top-6 lg:mt-0 [&>div]:rounded-[12px] [&>div]:border-0 [&>div]:bg-light [&>div]:p-4 [&>div>div>span:first-child]:mr-auto lg:[&>div]:bg-transparent lg:[&>div]:p-0 lg:[&>div>div]:gap-1.5 lg:[&>div>div>span:first-child]:hidden lg:[&>div>p]:sr-only">
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
            <div className="mt-5 grid grid-cols-2 gap-3 lg:mt-4 lg:gap-2.5">
              <code className="col-span-2 min-w-0 flex-[1_1_100%] break-all rounded-[12px] bg-light p-4 text-[13px] leading-[1.6] text-dark lg:p-2.5 lg:text-[12px]">
                /bundles/{activeCampaign.publicToken}
              </code>
              <button
                type="button"
                className="outline min-h-12 p-2.5! text-[12px] [@media(max-width:380px)]:gap-1.5! [@media(max-width:380px)]:text-[11px] lg:min-h-9"
                disabled={busy}
                onClick={() => void copy(activeCampaign)}
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}{" "}
                {copied ? "已複製" : "複製活動共同連結"}
              </button>
              {activeCampaign.enabled && (
                <a
                  className="outline min-h-12 p-2.5! text-[12px] [@media(max-width:380px)]:gap-1.5! [@media(max-width:380px)]:text-[11px] lg:min-h-9"
                  href={`/bundles/${activeCampaign.publicToken}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  預覽活動選單
                </a>
              )}
              {!activeCampaign.enabled && (
                <span className="col-span-2 text-[11px] text-muted">
                  開放活動後，客人才能查看及送出。
                </span>
              )}
            </div>
          </section>
        ) : null}
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
              <CloseButton
                aria-label="關閉活動編輯"
                disabled={busy}
                onClick={() => setModalOpen(false)}
                className="grid size-8 place-items-center"
                size={18}
              />
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

              {error && (
                <ErrorMessage className="text-[12px] text-danger">
                  {error}
                </ErrorMessage>
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
                  {busy && <Spinner size={14} />}
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
