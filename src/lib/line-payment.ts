/** Only read payment references next to their label, never arbitrary numbers
 * from the order confirmation or phone number in the same message. */
export function parsePaymentReport(
  message: string,
): { lastFive: string | null } | null {
  const text = message.normalize("NFKC").trim();
  if (/^\d{5}$/.test(text)) return { lastFive: text };

  const hasLabel = /(?:末|後)[五5]碼/.test(text);
  if (!hasLabel && !/已匯款|匯款完成|已轉帳/.test(text)) return null;

  // An explicit label takes precedence even when it is blank or invalid.
  // Multiple different references require clarification rather than guessing.
  const pattern = hasLabel
    ? /(?:末|後)[五5]碼\s*(?:[：:=]\s*)?(?:是|為)?\s*(?:[：:=]\s*)?[「"']?(\d{5})(?![A-Za-z0-9])/g
    : /(?:已匯款|匯款完成|已轉帳)\s*(?:[：:=]\s*)?[「"']?(\d{5})(?![A-Za-z0-9])/g;
  const values = new Set([...text.matchAll(pattern)].map((match) => match[1]));
  return { lastFive: values.size === 1 ? [...values][0] : null };
}
