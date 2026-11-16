export type FanmadeCraftTextResult = {
  items: Array<{ craft: string; stock: number }>;
  errors: string[];
  warnings: string[];
};

const LIST_SEPARATOR = /[、,，;；]/u;
const COLUMN_SEPARATOR = /[|｜\t]/u;
const NUMBER_LIKE =
  /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|Infinity|NaN)$/iu;

/** Parse drafts only. Callers must not apply any items while errors is nonempty. */
export function parseFanmadeCraftText(
  text: string,
  defaultStock: string,
  options: {
    preserveDuplicates?: boolean;
    stockDefaults?: Record<string, string>;
  } = {},
): FanmadeCraftTextResult {
  const items: FanmadeCraftTextResult["items"] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  const warned = new Set<string>();

  function append(craftText: string, stockText: string, source: string) {
    const craft = craftText.trim();
    const stockValue = stockText.trim();
    let valid = true;
    if (!craft || [...craft].length > 100) {
      errors.push(`${source}：工藝名稱必須為 1 至 100 字。`);
      valid = false;
    }
    if (!/^\d+$/u.test(stockValue) || Number(stockValue) > 1000) {
      errors.push(`${source}：庫存必須為 0 至 1000 的整數。`);
      valid = false;
    }
    if (!valid) return;
    const stock = Number(stockValue);
    if (options.preserveDuplicates) {
      items.push({ craft, stock });
      return;
    }
    const existing = seen.get(craft);
    if (existing !== undefined) {
      if (existing !== stock) {
        errors.push(
          `${source}：「${craft}」出現不同庫存（${existing}、${stock}），請合併為單一設定。`,
        );
      } else if (!warned.has(craft)) {
        warned.add(craft);
        warnings.push(`「${craft}」工藝與庫存重複，已合併為一種。`);
      }
      return;
    }
    seen.set(craft, stock);
    items.push({ craft, stock });
  }

  for (const [index, rawLine] of text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .entries()) {
    if (!rawLine.trim()) continue;
    const source = `第 ${index + 1} 行`;
    if (COLUMN_SEPARATOR.test(rawLine)) {
      const columns = rawLine.split(COLUMN_SEPARATOR);
      if (columns.length !== 2 || LIST_SEPARATOR.test(rawLine)) {
        errors.push(
          `${source}：指定庫存時請一行一種工藝，格式為「工藝｜數量」。`,
        );
        continue;
      }
      append(columns[0], columns[1], source);
      continue;
    }
    // Avoid turning a quantity such as "1,000" into a second craft called "000".
    if (/\s[+-]?\d+[，,]\d+(?:\s|$)/u.test(rawLine)) {
      errors.push(`${source}：庫存請填未加千分位逗號的整數。`);
      continue;
    }
    const segments = rawLine.split(LIST_SEPARATOR);
    for (const [segmentIndex, segment] of segments.entries()) {
      const label =
        segments.length === 1 ? source : `${source}第 ${segmentIndex + 1} 項`;
      const value = segment.trim();
      const suffix = /^(.*?)\s+(\S+)$/u.exec(value);
      if (suffix && NUMBER_LIKE.test(suffix[2])) {
        append(suffix[1], suffix[2], label);
      } else {
        const existingStock =
          options.stockDefaults && Object.hasOwn(options.stockDefaults, value)
            ? options.stockDefaults[value]
            : undefined;
        append(
          value,
          existingStock ?? defaultStock,
          `${label}（${existingStock === undefined ? "使用預設" : "保留既有"}庫存）`,
        );
      }
    }
  }
  if (items.length > 50) {
    errors.push(
      `一次最多 50 ${options.preserveDuplicates ? "筆工藝設定" : "種工藝"}，目前有 ${items.length} 筆，請分批處理。`,
    );
  }
  if (!items.length && !errors.length) errors.push("請至少輸入一種工藝。");
  return { items, errors, warnings };
}
