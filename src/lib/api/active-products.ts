type QueryError = { code?: string; message?: string } | null;

/** Retry only when the merge column is physically absent; preserve filtering for all other failures. */
export async function readActiveProducts<T extends { error: QueryError }>(
  query: (filterMerged: boolean) => PromiseLike<T>,
): Promise<T> {
  const result = await query(true);
  const error = result.error;
  if (
    error &&
    error.code === "42703" &&
    error.message?.includes("merged_into_product_id") &&
    error.message.includes("products")
  ) {
    return query(false);
  }
  return result;
}
