import { COUNTRIES, POSTER_FORMATS } from "@/constants";
import {
  buildPreorderProductName,
  cleanPreorderNamePart,
} from "./preorder-product-name";

export const MAX_PREORDER_BATCH = 50;
export const MAX_PREORDER_TEXT = 10_000;
export type PreorderImportRow = {
  id: string;
  source: string;
  work: string;
  country: string;
  itemName: string;
  price: string;
  size: string;
  format: string;
  notes: string[];
};
export type PreorderImportDefaults = {
  work: string;
  country: string;
  size: string;
  format: string;
};
export const PREORDER_IMPORT_EXAMPLE =
  "蜘蛛人，全部 A3\n韓版 A、B、C款各350元\n日版全員款450元\n美版肖像款500元，特別場";

const aliases: Array<[string, string]> = [
  ["(?:🎨\\s*)?(?:飯製版?|饭制版?|飯制版?|同人版?)|🎨", "飯製"],
  ["🇰🇷|韓國版?|韩国版?|韓版|韩版|Korea\\b|KR\\b", "韓國"],
  ["🇯🇵|日本版?|日版|Japan\\b|JP\\b", "日本"],
  ["🇹🇼|台灣版?|臺灣版?|台湾版?|台版|臺版|Taiwan\\b|TW\\b", "台灣"],
  ["🇭🇰|香港版?|港版|Hong Kong\\b|HK\\b", "香港"],
  ["🇨🇳|大陸版?|大陆版?|中國版?|中国版?|陸版|陆版|China\\b|CN\\b", "大陸"],
  [
    "🇲🇾|馬來西亞版?|马来西亚版?|馬來版|马来版|大馬版?|大马版?|Malaysia\\b|MY\\b",
    "馬來西亞",
  ],
  ["🇺🇸|北美版?|美國版?|美国版?|美版|USA?\\b|North America\\b", "北美"],
];
const countryPattern = aliases.map(([pattern]) => `(?:${pattern})`).join("|");
const sizePattern = /(?:\b[AB]\d\b|\b\d{2,3}\s*[x×*]\s*\d{2,3}\s*(?:cm)?\b)/gi;
const formatPattern =
  /Dolby\s*Cinema|SCREEN\s*X|MX4D|IMAX|Dolby|4DX|2D|3D|特別場|特别场|一般版|其他特殊版本/gi;
const foreignCurrency =
  /USD|US\$|JPY|KRW|MYR|HKD|RMB|\bRM\b|美金|美元|日幣|日元|日币|韓元|韩元|馬幣|马币|港幣|港币|人民幣|人民币|[¥￥円]/i;
const fees = /運費|运费|送料|訂金|订金|尾款|代購費|代购费|截止|限量|數量|数量/;
const cleanEdges = (text: string) =>
  text.replace(/^[\s,，:：;；、]+|[\s,，:：;；、]+$/g, "");
function specs(text: string) {
  const size = text
    .match(sizePattern)
    ?.at(-1)
    ?.toUpperCase()
    .replace(/\s|CM/g, "")
    .replace(/[X*]/g, "×");
  const rawFormat = text.match(formatPattern)?.at(-1);
  const format = rawFormat
    ? /^dolby/i.test(rawFormat)
      ? "Dolby Cinema"
      : /screen/i.test(rawFormat)
        ? "SCREENX"
        : rawFormat === "特别场"
          ? "特別場"
          : rawFormat.toUpperCase()
    : undefined;
  return { size, format };
}
function countryOf(text: string) {
  return aliases.find(([pattern]) => new RegExp(pattern, "i").test(text))?.[1];
}
function itemLabel(text: string, work: string) {
  let label = cleanEdges(
    text.replace(new RegExp(countryPattern, "gi"), "").replace(sizePattern, ""),
  );
  label = label
    .replace(/^(?:商品|品項|品项|款式|版本)\s*[:：]\s*/, "")
    .replace(
      /(?:各|每款|每張|每张|每件|分別|分别|售價|售价|價格|价格|單價|单价|共|總價|总价)\s*[:：]?\s*$/g,
      "",
    );
  if (work && label.startsWith(work)) label = label.slice(work.length);
  return cleanPreorderNamePart(cleanEdges(label));
}
function options(label: string, bundle: boolean) {
  if (bundle) return [label.replace(/一套|整套/g, "套組")];
  const parts = label
    .split(
      /^[A-Za-z](?:款)?(?:\s+[A-Za-z](?:款)?)+$/.test(label)
        ? /\s+/
        : /[、,，/／+＋]/,
    )
    .map(cleanEdges)
    .filter(Boolean);
  if (parts.length < 2)
    return [/^[A-Za-z]$/.test(label) ? `${label.toUpperCase()}款` : label];
  return parts.map((part) =>
    /^[A-Za-z](?:款)?$/.test(part) ? `${part[0].toUpperCase()}款` : part,
  );
}

export function parsePreorderText(
  text: string,
  defaults: PreorderImportDefaults,
) {
  const rows: PreorderImportRow[] = [],
    warnings: string[] = [];
  const context = { ...defaults };
  let counter = 0,
    limitExceeded = false;
  const normalized = text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(
      new RegExp(
        `[，,](?=\\s*(?:${countryPattern}|全部|統一|统一|作品[:：]|主題[:：]|主题[:：]))`,
        "gi",
      ),
      "\n",
    );
  const add = (
    source: string,
    country: string,
    label: string,
    price: string,
    size: string,
    format: string,
    notes: string[],
  ) => {
    if (rows.length >= MAX_PREORDER_BATCH + 1) {
      limitExceeded = true;
      return;
    }
    rows.push({
      id: `row-${++counter}`,
      source,
      work: context.work,
      country,
      itemName: label,
      price,
      size,
      format,
      notes,
    });
    if (rows.length > MAX_PREORDER_BATCH) limitExceeded = true;
  };
  for (const raw of normalized
    .split(/[\n;；]+/)
    .map(cleanEdges)
    .filter(Boolean)) {
    const countries = [...raw.matchAll(new RegExp(countryPattern, "gi"))];
    const pieces =
      countries.length > 1
        ? countries.map((match, i) =>
            raw.slice(match.index, countries[i + 1]?.index ?? raw.length),
          )
        : [raw];
    if (countries.length && countries[0].index! > 0) {
      const prefix = cleanEdges(raw.slice(0, countries[0].index));
      if (prefix && !/\d/.test(prefix))
        context.work = prefix.replace(/^(?:作品|主題|主题|IP)\s*[:：]\s*/i, "");
    }
    for (const piece of pieces) {
      const source = cleanEdges(piece);
      // An explicit title can contain years or numbers without becoming a price.
      const heading = source.match(/^(?:作品|主題|主题|IP)\s*[:：]\s*(.+)$/i);
      if (heading && !countryOf(heading[1])) {
        context.work = cleanPreorderNamePart(heading[1]);
        continue;
      }
      const country = countryOf(source) ?? context.country,
        found = specs(source);
      const onlySettings = /^(?:全部|統一|统一|尺寸|版本)/.test(source);
      if (onlySettings && !countryOf(source)) {
        if (found.size) context.size = found.size;
        if (found.format) context.format = found.format;
        const remaining = source
          .replace(sizePattern, "")
          .replace(formatPattern, "")
          .replace(/全部|統一|统一|尺寸|版本|[:：,，\s]/g, "");
        if (remaining)
          warnings.push(`「${source}」有未辨識的共同設定，請核對預覽。`);
        continue;
      }
      // Mask specifications, numeric item labels and dates before finding prices.
      const masked = source
        .replace(sizePattern, (value) => " ".repeat(value.length))
        .replace(formatPattern, (value) => " ".repeat(value.length))
        .replace(
          /\d+\s*[款號号]|\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,2})?\b/g,
          (value) => " ".repeat(value.length),
        );
      const priceRegex =
        /(?:(?:NT\$|NTD|TWD|\$|各|每款|每張|每张|每件|售價|售价|單價|单价|價格|价格)\s*[:：]?\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:元|塊|块|台幣|臺幣)?/gi;
      const prices = [...masked.matchAll(priceRegex)].filter((match) =>
        /\d{2}|元|塊|块|\$|各|每|價|价|NTD|TWD/i.test(match[0]),
      );
      if (!prices.length && !countryOf(source)) {
        if (fees.test(source)) {
          warnings.push(`略過「${source}」，請在預覽核對。`);
          continue;
        }
        if (found.size || found.format) {
          if (found.size) context.size = found.size;
          if (found.format) context.format = found.format;
          const heading = cleanEdges(
            source
              .replace(sizePattern, "")
              .replace(formatPattern, "")
              .replace(/全部|統一|统一|尺寸|版本/g, ""),
          );
          if (heading) context.work = heading;
        } else
          context.work = source.replace(
            /^(?:作品|主題|主题|IP)\s*[:：]\s*/i,
            "",
          );
        continue;
      }
      if (!prices.length) {
        add(
          source,
          country,
          itemLabel(source, context.work),
          "",
          found.size ?? context.size,
          found.format ?? context.format,
          ["沒有辨識到售價，請補上 NT$ 金額。"],
        );
        continue;
      }
      let previousEnd = 0;
      for (const price of prices) {
        const label = itemLabel(
          source.slice(previousEnd, price.index),
          context.work,
        );
        previousEnd = price.index! + price[0].length;
        if (fees.test(label)) {
          warnings.push(`未將「${label}」視為商品，請核對售價。`);
          continue;
        }
        const bundle = /套組|套组|一套|整套|組合|组合/.test(label);
        const labels = options(label, bundle),
          shared = /各|每款|每張|每张|每件|分別|分别/.test(
            price[0] + source.slice(0, price.index),
          );
        const uncertain = labels.length > 1 && !shared;
        const foreign = foreignCurrency.test(source);
        const amount =
          price[0]
            .match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/)?.[0]
            .replaceAll(",", "") ?? "";
        for (const name of labels)
          add(
            source,
            country,
            name,
            uncertain || foreign ? "" : amount,
            found.size ?? context.size,
            found.format ?? context.format,
            [
              uncertain ? "多款未註明各款售價，請逐項填寫。" : "",
              foreign ? "原文包含外幣，請確認後填入 NT$ 售價。" : "",
            ].filter(Boolean),
          );
      }
      const tail = cleanEdges(
        source
          .slice(previousEnd)
          .replace(sizePattern, "")
          .replace(formatPattern, ""),
      );
      if (tail && !/^(?:含稅|含税|台幣|臺幣|TWD|NTD)$/i.test(tail))
        warnings.push(`「${source}」尾段「${tail}」請另外核對。`);
    }
  }
  return { rows, warnings: [...new Set(warnings)], limitExceeded };
}

export function preorderRowErrors(
  row: PreorderImportRow,
  requireItemName: boolean,
) {
  const errors: string[] = [];
  if (!cleanPreorderNamePart(row.work) || row.work.length > 200)
    errors.push("請填寫作品名稱（最多 200 字元）");
  if (!(COUNTRIES as readonly string[]).includes(row.country))
    errors.push("請選擇國家版本");
  if ((requireItemName && !row.itemName.trim()) || row.itemName.length > 200)
    errors.push("請填寫品項名稱（最多 200 字元）");
  const amount = Number(row.price);
  if (
    !row.price.trim() ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 9_999_999_999.99 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
  )
    errors.push("請填寫 NT$ 售價，最多兩位小數");
  if (row.size.length > 100 || row.format.length > 100)
    errors.push("尺寸或版本過長");
  if (row.format && !(POSTER_FORMATS as readonly string[]).includes(row.format))
    errors.push("請選擇有效版本");
  if (
    buildPreorderProductName(row.country, row.work, row.itemName).length > 300
  )
    errors.push("組合後名稱最多 300 字元");
  return errors;
}
export function preorderRowKey(
  row: Pick<
    PreorderImportRow,
    "work" | "country" | "itemName" | "size" | "format"
  >,
) {
  return JSON.stringify([
    cleanPreorderNamePart(row.work),
    row.country,
    cleanPreorderNamePart(row.itemName),
    row.size.trim(),
    row.format.trim(),
  ]);
}
