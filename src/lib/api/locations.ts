import { API_ROUTES } from "@/constants";
import { readApiResponse } from "@/lib/api/http-client";

export async function createLocation(input: {
  code: string;
  description: string;
}) {
  const response = await fetch(API_ROUTES.locations, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readApiResponse<{ id: string; code: string }>(response);
}
