/** Quote a literal substring for PostgREST; user punctuation cannot add filters. */
export function claimCustomerSearchFilter(query: string): string {
  const escaped = query.trim().replace(/[\\%_]/g, "\\$&");
  const value = JSON.stringify(`%${escaped}%`);
  return ["nickname", "phone_normalized", "confirmation_code"]
    .map((column) => `${column}.ilike.${value}`)
    .join(",");
}
