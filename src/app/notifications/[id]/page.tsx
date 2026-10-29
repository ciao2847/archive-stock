import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApiUser } from "@/lib/api/server-auth";
import { loadPushOrder, type OrderPushEvent } from "@/lib/push/server";

export default async function NotificationOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();
  const auth = await requireApiUser();
  if (!auth.ok) {
    if (auth.response.status === 401)
      redirect(
        `/login?returnTo=${encodeURIComponent(`/notifications/${id.data}`)}`,
      );
    notFound();
  }
  const db = auth.supabase as unknown as SupabaseClient;
  const { data: event, error } = await db
    .from("order_push_events")
    .select("id,inventory_id,kind,source_id")
    .eq("id", id.data)
    .maybeSingle();
  if (error || !event) notFound();
  // Only the authenticated RLS read above authorizes access to this event.
  if (auth.role !== "admin" && event.inventory_id !== auth.inventoryOwnerId)
    notFound();
  const order = await loadPushOrder(event as OrderPushEvent);
  if (!order) notFound();
  const money = (value: number) => `$${value.toLocaleString("zh-TW")}`;
  return (
    <main className="mx-auto min-h-screen max-w-[760px] px-4 py-8 sm:py-12">
      <section className="card p-5 sm:p-8">
        <span className="eyebrow">{order.inventory}｜新訂購通知</span>
        <h1 className="mb-2 mt-3 text-[25px]">{order.title}</h1>
        <p className="mt-0 text-sm text-muted">確認編號：{order.code}</p>
        <div className="my-5 grid gap-2 rounded-lg bg-light p-4 text-sm">
          <p className="m-0">訂購人：{order.nickname}</p>
          <p className="m-0">
            訂購時間：
            {new Date(order.createdAt).toLocaleString("zh-TW", {
              timeZone: "Asia/Taipei",
            })}
          </p>
        </div>
        <ul className="m-0 list-none divide-y divide-line p-0">
          {order.items.map((item, index) => (
            <li
              key={index}
              className="flex items-start justify-between gap-4 py-4 text-sm"
            >
              <span>
                {item.name} × {item.quantity}
              </span>
              <strong className="shrink-0">
                {item.price == null
                  ? "包含於總額"
                  : money(item.quantity * item.price)}
              </strong>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between rounded-lg bg-primary px-4 py-4 text-white">
          <span>共 {order.count} 件</span>
          <strong style={{ color: "#fff" }}>{money(order.total)}</strong>
        </div>
        <p className="mt-4 text-xs leading-6 text-muted">
          付款與出貨狀態請至管理頁查看最新紀錄。
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="primary no-underline"
            href={event.kind === "claim" ? "/claims" : "/bundle-claims"}
          >
            前往{event.kind === "claim" ? "訂購" : "配單"}管理
          </Link>
          <Link className="outline no-underline" href="/">
            回到工作台
          </Link>
        </div>
      </section>
    </main>
  );
}
