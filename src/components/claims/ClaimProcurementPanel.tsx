"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardList, Download, History } from "lucide-react";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { formatTaipeiDateTime } from "@/lib/claims";
import {
  buildClaimProcurementCsv,
  ClaimProcurementError,
  closeClaimProcurement,
  fetchClaimProcurement,
  type ClaimProcurementData,
  type CloseClaimProcurementInput,
} from "@/lib/claim-procurement";
import styles from "../../../styles/components/claims/ClaimProcurementPanel.module.scss";

type Props = {
  ownerId: string;
  formId: number;
  formTitle: string;
  onClosed?: () => Promise<void> | void;
};
const money = (value: number) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 2,
  }).format(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readPending(
  key: string,
  ownerId: string,
  formId: number,
): CloseClaimProcurementInput | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value?.ownerId === ownerId &&
      value.formId === formId &&
      uuid.test(value.roundId) &&
      uuid.test(value.requestId)
      ? { ownerId, formId, roundId: value.roundId, requestId: value.requestId }
      : null;
  } catch {
    return null;
  }
}
function persist(key: string, input: CloseClaimProcurementInput | null) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    /* Mounted state still retains the idempotency key. */
  }
}
export function ClaimProcurementPanel(props: Props) {
  return (
    <ProcurementScope key={`${props.ownerId}:${props.formId}`} {...props} />
  );
}
function ProcurementScope({ ownerId, formId, formTitle, onClosed }: Props) {
  const [data, setData] = useState<ClaimProcurementData | null>(null),
    [loading, setLoading] = useState(true),
    [closing, setClosing] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState<CloseClaimProcurementInput | null>(
      null,
    ),
    [historyPage, setHistoryPage] = useState(1);
  const controller = useRef<AbortController | null>(null),
    sequence = useRef(0),
    mounted = useRef(false),
    closingRef = useRef(false);
  const storageKey = `archive-claim-procurement:${ownerId}:${formId}`;
  const load = useCallback(
    async (roundId?: string, page = 1, appendHistory = false) => {
      const ticket = ++sequence.current;
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setLoading(true);
      setError("");
      try {
        const result = await fetchClaimProcurement(
          ownerId,
          formId,
          roundId,
          page,
          current.signal,
        );
        if (!current.signal.aborted && ticket === sequence.current) {
          setData((previous) => ({
            ...result,
            history: appendHistory
              ? [
                  ...new Map(
                    [...(previous?.history || []), ...result.history].map(
                      (item) => [item.id, item],
                    ),
                  ).values(),
                ]
              : result.history,
          }));
          setHistoryPage(page);
        }
      } catch (cause) {
        if (!current.signal.aborted && ticket === sequence.current)
          setError(cause instanceof Error ? cause.message : "叫貨資料讀取失敗");
      } finally {
        if (!current.signal.aborted && ticket === sequence.current)
          setLoading(false);
      }
    },
    [ownerId, formId],
  );
  useEffect(() => {
    mounted.current = true;
    const restored = readPending(storageKey, ownerId, formId);
    setPending(restored);
    void load(restored?.roundId);
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [ownerId, formId, storageKey, load]);
  const selectedClosed = data?.selected.status === "closed";
  const selectedRound = selectedClosed ? data?.selected.id : undefined;
  const history = useMemo(() => {
    if (!data) return [];
    if (
      data.selected.status !== "closed" ||
      data.history.some((item) => item.id === data.selected.id)
    )
      return data.history;
    return [
      {
        ...data.selected,
        closedAt: data.selected.closedAt || data.selected.createdAt,
      },
      ...data.history,
    ];
  }, [data]);
  async function closeRound() {
    if (closingRef.current || loading || !data) return;
    const input = pending || {
      ownerId,
      formId,
      roundId: data.current.id,
      requestId: crypto.randomUUID(),
    };
    if (
      !pending &&
      !window.confirm(
        `本次將結算第 ${data.current.number} 批的 ${data.current.paidSubmissionCount} 筆已付款訂單，共 ${data.current.itemCount} 件。未付款訂單留到下一批，不更動表單的開放狀態。確定結單並產生叫貨單？`,
      )
    )
      return;
    closingRef.current = true;
    setClosing(true);
    setError("");
    setMessage("");
    setPending(input);
    persist(storageKey, input);
    try {
      const result = await closeClaimProcurement(input);
      persist(storageKey, null);
      if (!mounted.current) return;
      setPending(null);
      setMessage(
        "本次已結單並保存叫貨明細。未付款訂單已留到下一批，之後的新訂單重新統計。",
      );
      await load(result.closedRoundId);
      try {
        if (mounted.current) await onClosed?.();
      } catch {
        if (mounted.current)
          setError("結單已完成，其他清單重新整理失敗；可稍後重新整理。");
      }
    } catch (cause) {
      const definitive =
        cause instanceof ClaimProcurementError &&
        [400, 404, 409].includes(cause.status);
      if (definitive) persist(storageKey, null);
      if (mounted.current) {
        if (definitive) {
          setPending(null);
          await load();
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "無法確認結單結果，請使用原批次重試。",
        );
      }
    } finally {
      closingRef.current = false;
      if (mounted.current) setClosing(false);
    }
  }
  function download() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([buildClaimProcurementCsv(data.selected)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${formTitle.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100)}-第${data.selected.number}批-${selectedClosed ? "結單叫貨單" : "本次已付款叫貨預覽"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const disabled = loading || closing;
  return (
    <section className={styles.panel} aria-label={`${formTitle}本次結單與叫貨`}>
      <div className={styles.header}>
        <div>
          <span className="eyebrow">
            <ClipboardList size={14} /> 分批叫貨
          </span>
          <h2>本次結單與叫貨</h2>
          <p>
            只統計已付款訂單。每次結單保存明細，未付款或部分付款留到下一批，訂單與付款紀錄持續保留。
          </p>
        </div>
        <RefreshButton
          label="重新載入結單資料"
          loading={loading}
          disabled={closing}
          onClick={() => void load(selectedRound)}
        />
      </div>
      {error && <ErrorMessage className={styles.error}>{error}</ErrorMessage>}
      {message && (
        <p className={styles.notice} role="status">
          <Check size={16} />
          {message}
        </p>
      )}
      {pending && (
        <p className={styles.notice} role="status">
          上次結單結果待確認。請按「重試確認本次結單」，會沿用同一批次，不會重複結單。
        </p>
      )}
      {!data && loading && <p role="status">正在載入本次叫貨數量…</p>}
      {data && (
        <>
          <div className={styles.current} aria-label="目前進行中的結單批次">
            <h3>第 {data.current.number} 批 · 進行中</h3>
            <dl>
              <div>
                <dt>本次已付款</dt>
                <dd>{data.current.paidSubmissionCount} 筆</dd>
              </div>
              <div>
                <dt>本次叫貨數量</dt>
                <dd>{data.current.itemCount} 件</dd>
              </div>
              <div>
                <dt>未付或部分款，留待結單</dt>
                <dd>{data.current.unpaidSubmissionCount} 筆</dd>
              </div>
            </dl>
            <button
              type="button"
              className="primary"
              disabled={disabled || (!pending && data.current.itemCount === 0)}
              onClick={() => void closeRound()}
            >
              {closing
                ? "正在確認結單…"
                : pending
                  ? "重試確認本次結單"
                  : "結單並產生叫貨單"}
            </button>
          </div>
          <div className={styles.toolbar}>
            <label>
              <History size={16} /> 查看批次
              <select
                aria-label="查看叫貨批次"
                value={selectedClosed ? data.selected.id : ""}
                disabled={disabled || Boolean(pending)}
                onChange={(event) => void load(event.target.value || undefined)}
              >
                <option value="">
                  第 {data.current.number} 批 · 本次已付款預覽
                </option>
                {history.map((round) => (
                  <option key={round.id} value={round.id}>
                    第 {round.number} 批 · 已結單 ·{" "}
                    {formatTaipeiDateTime(round.closedAt)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="outline"
              disabled={disabled || !data.selected.lines.length}
              onClick={download}
            >
              <Download size={15} />
              {selectedClosed ? "下載本批叫貨 CSV" : "下載本次叫貨預覽"}
            </button>
            {data.historyHasMore && (
              <button
                type="button"
                className="outline"
                disabled={disabled || Boolean(pending)}
                onClick={() => void load(selectedRound, historyPage + 1, true)}
              >
                載入較早結單
              </button>
            )}
          </div>
          <div className={styles.detailHeading}>
            <h3>
              第 {data.selected.number} 批 ·{" "}
              {selectedClosed ? "已結單叫貨明細" : "已付款叫貨預覽"}
            </h3>
            <span>
              {data.selected.itemCount} 件 · {money(data.selected.totalAmount)}
            </span>
          </div>
          {selectedClosed && (
            <p className={styles.hint}>
              結單時間：
              {formatTaipeiDateTime(
                data.selected.closedAt || data.selected.createdAt,
              )}
              。以下為結單當時保存的數量，後續更名、付款異動不會覆寫本批明細。
            </p>
          )}
          {data.selected.lines.length ? (
            <div className={styles.lines}>
              {data.selected.lines.map((line, index) => (
                <article
                  className={styles.line}
                  key={`${line.productId || line.sku}:${index}`}
                >
                  <div>
                    <span className={styles.ip}>{line.ip || "未分類 IP"}</span>
                    <h4>{line.name}</h4>
                    {line.craft && (
                      <span className={styles.craft}>{line.craft}</span>
                    )}
                    <small>{line.sku}</small>
                  </div>
                  <dl>
                    <div>
                      <dt>叫貨數量</dt>
                      <dd>{line.quantity}</dd>
                    </div>
                    <div>
                      <dt>訂購人數</dt>
                      <dd>{line.customerCount} 人</dd>
                    </div>
                    <div>
                      <dt>金額</dt>
                      <dd>{money(line.amount)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              這一批目前沒有可結單的已付款商品。未付款訂單會保留，付款後再計入叫貨。
            </p>
          )}
        </>
      )}
    </section>
  );
}
