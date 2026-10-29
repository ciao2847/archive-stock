import { authorizedDispatcher, dispatchOrderPushes } from "@/lib/push/server";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorizedDispatcher(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await dispatchOrderPushes(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error("Order notification worker deferred");
    return Response.json(
      { error: "Notification worker unavailable" },
      { status: 503 },
    );
  }
}
