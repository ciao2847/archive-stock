const COUNTRY_FLAGS: Record<string, string> = {
  韓國: "🇰🇷",
  日本: "🇯🇵",
  台灣: "🇹🇼",
  香港: "🇭🇰",
  大陸: "🇨🇳",
  馬來西亞: "🇲🇾",
  北美: "🇺🇸",
  飯製: "🎨",
};

export function cleanPreorderNamePart(value: string) {
  return value
    .trim()
    .replace(/^(?:(?:[\u{1F1E6}-\u{1F1FF}]{2}|🎨)\s*)+/u, "")
    .trim();
}

export function buildPreorderProductName(
  country: string,
  work: string,
  itemName = "",
) {
  return [
    COUNTRY_FLAGS[country.trim()],
    cleanPreorderNamePart(work),
    cleanPreorderNamePart(itemName),
  ]
    .filter(Boolean)
    .join(" ");
}

// This is an editable suggestion; changing the activity title never renames a product.
export function suggestPreorderWorkName(formTitle: string) {
  return formTitle
    .trim()
    .replace(/\s*[｜|·－-]?\s*(?:預購|訂購)(?:表單)?\s*$/u, "")
    .trim();
}

// Inventory labels use the saved country without changing the product name.
export function productNameWithCountryFlag(name: string, country: string) {
  const flag = COUNTRY_FLAGS[country.trim()];
  if (
    !flag ||
    flag === "🎨" ||
    /^[\u{1F1E6}-\u{1F1FF}]{2}/u.test(name.trimStart())
  ) {
    return name;
  }
  return `${flag} ${name}`;
}
