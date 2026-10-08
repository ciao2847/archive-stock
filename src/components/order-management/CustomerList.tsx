"use client";

export type CustomerListRow = {
  key: string;
  name: string;
  amount: string;
  status: string;
  statusClassName?: string;
  description?: string;
};

export function CustomerList({
  rows,
  selectedKey,
  onSelect,
  disabled = false,
}: {
  rows: CustomerListRow[];
  selectedKey?: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-3" role="group" aria-label="顧客清單">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          disabled={disabled}
          aria-pressed={selectedKey === row.key}
          aria-label={`查看 ${row.name} 的明細`}
          onClick={() => onSelect(row.key)}
          className={`min-w-0 rounded-[10px] border p-4 text-left transition ${selectedKey === row.key ? "border-primary bg-primary-soft/55" : "border-line bg-white hover:border-primary/50"}`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <strong className="min-w-0 break-words text-[15px] text-dark">
              {row.name}
            </strong>
            <strong className="shrink-0 text-[15px] text-[#B7791F]">
              {row.amount}
            </strong>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            {row.description && (
              <span className="min-w-0 break-words text-[11px] text-muted">
                {row.description}
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${row.statusClassName || "bg-light text-muted"}`}
            >
              {row.status}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
