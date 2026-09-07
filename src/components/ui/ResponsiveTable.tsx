import type { ReactNode } from "react";

export type TableColumn = {
  key: string;
  label: ReactNode;
  className?: string;
};

/** 共用響應式表格骨架。 */
export function ResponsiveTable({
  columns,
  children,
  header,
  colGroup,
  empty,
  compact = false,
  hideHeaderOnMobile = false,
  wrapperClassName = "",
  tableClassName = "",
  theadClassName = "",
  tbodyClassName = "",
}: {
  columns: TableColumn[];
  children: ReactNode;
  header?: ReactNode;
  colGroup?: ReactNode;
  empty?: ReactNode;
  compact?: boolean;
  hideHeaderOnMobile?: boolean;
  wrapperClassName?: string;
  tableClassName?: string;
  theadClassName?: string;
  tbodyClassName?: string;
}) {
  return (
    <section
      className={`${compact ? "table-wrap" : "card table-wrap"} ${wrapperClassName}`}
    >
      {header}
      <table className={tableClassName}>
        {colGroup}
        <thead
          className={
            theadClassName || (hideHeaderOnMobile ? "max-sm:hidden" : undefined)
          }
        >
          <tr className="border-b border-b-line">
            {columns?.map((column) => (
              <th className={column.className} key={column.key}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbodyClassName || undefined}>{children}</tbody>
      </table>
      {empty}
    </section>
  );
}
