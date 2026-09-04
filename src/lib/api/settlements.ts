import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export async function createSettlement(input: {
  ownerId: string;
  start: string;
  end: string;
}) {
  const response = await fetch(API_ROUTES.settlements, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ settlement: unknown }>(response);
}
