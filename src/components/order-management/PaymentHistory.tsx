export type PaymentDisplayRecord = {
  key: string;
  amount: string;
  transferredAt: string;
  lastFive?: string;
  note?: string;
};

export function PaymentHistory({
  records,
}: {
  records: PaymentDisplayRecord[];
}) {
  if (!records.length) return null;
  return (
    <details className="text-[12px] text-muted">
      <summary className="cursor-pointer font-semibold">
        匯款紀錄（{records.length}）
      </summary>
      <div className="mt-2 divide-y divide-line">
        {records.map((record) => (
          <div key={record.key} className="py-2">
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="text-dark">{record.amount}</strong>
              <span>{record.transferredAt}</span>
            </div>
            {record.lastFive && (
              <p className="mb-0 mt-1">末五碼：{record.lastFive}</p>
            )}
            {record.note && (
              <p className="mb-0 mt-1 whitespace-pre-wrap break-words">
                {record.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
