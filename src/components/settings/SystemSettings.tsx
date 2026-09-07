"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Database,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { DataState } from "@/components/ui/DataState";
import { API_ROUTES } from "@/constants";

/** 系統設定面板。 */
export function SystemSettings({
  isAdmin,
  inventories,
  inventoryDatabases,
  availableUsers,
  selectedInventoryId,
  onInventoryChange,
  onInventoryDatabaseUpdated,
}: {
  isAdmin: boolean;
  inventories: Array<{ id: string; name: string }>;
  inventoryDatabases: Array<{ id: string; name: string; ownerIds: string[] }>;
  availableUsers: Array<{ id: string; name: string }>;
  selectedInventoryId: string;
  onInventoryChange: (inventoryId: string) => void;
  onInventoryDatabaseUpdated: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("載入中…");
  const [name, setName] = useState("—");
  const [role, setRole] = useState("staff");
  const [loading, setLoading] = useState(true);
  const [hasAccount, setHasAccount] = useState(false);
  const [creatingDatabase, setCreatingDatabase] = useState(false);
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setEmail(user.email || "—");
      const { data } = await supabase
        .from("profiles")
        .select("display_name,role")
        .eq("id", user.id)
        .maybeSingle();
      setName(data?.display_name || user.email?.split("@")[0] || "使用者");
      setRole(data?.role || "staff");
      setHasAccount(true);
      setLoading(false);
    })();
  }, []);
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const cardClass = "card flex gap-5 p-6";
  const iconClass =
    "grid h-12 w-12 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-rust";
  return (
    <DataState
      loading={loading}
      isEmpty={!hasAccount}
      loadingText="正在讀取帳號資料…"
      emptyText="找不到帳號資料"
    >
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {isAdmin && (
          <section className="card col-[1/-1] flex gap-5 p-6 max-lg:col-auto">
            <div className={`${iconClass} bg-primary-soft text-primary`}>
              <UserRound />
            </div>
            <SettingsCardContent
              eyebrow="使用者資料"
              title="切換庫藏資料庫"
              description="庫存、出貨、訂單、庫位與財務都會切換至同一個庫藏資料庫。"
            >
              <label className="block max-w-[360px]">
                <span className="sr-only">選擇使用者</span>
                <select
                  className="mt-1 block w-full rounded-lg border border-line bg-white p-3 text-[14px] outline-none max-lg:text-[16px]"
                  value={selectedInventoryId}
                  onChange={(event) => onInventoryChange(event.target.value)}
                  aria-label="選擇庫藏資料庫"
                >
                  {inventories.map((inventory) => (
                    <option key={inventory.id} value={inventory.id}>
                      {inventory.name}
                    </option>
                  ))}
                </select>
              </label>
            </SettingsCardContent>
          </section>
        )}
        {isAdmin && (
          <section className="card col-[1/-1] p-6">
            <div className="flex items-start justify-between gap-4 max-lg:flex-col">
              <div>
                <span className="eyebrow">庫藏資料庫權限</span>
                <h2 className="mb-1 mt-2">命名與擁有者</h2>
                <p className="mb-5 mt-0 text-muted">
                  每個資料庫至少需要一位擁有者；同一帳號一次歸屬一個庫藏資料庫。
                </p>
              </div>
              <button
                className="outline shrink-0"
                type="button"
                onClick={() => setCreatingDatabase(true)}
                disabled={creatingDatabase}
              >
                新增資料庫
              </button>
            </div>
            <div className="grid gap-4">
              {creatingDatabase && (
                <InventoryDatabaseEditor
                  inventory={{ id: "", name: "", ownerIds: [] }}
                  users={availableUsers}
                  onSaved={async () => {
                    setCreatingDatabase(false);
                    await onInventoryDatabaseUpdated();
                  }}
                />
              )}
              {inventoryDatabases.map((inventory) => (
                <InventoryDatabaseEditor
                  key={`${inventory.id}:${inventory.name}:${inventory.ownerIds.join(",")}`}
                  inventory={inventory}
                  users={availableUsers}
                  onSaved={onInventoryDatabaseUpdated}
                />
              ))}
            </div>
          </section>
        )}
        <section className={cardClass}>
          <div className={iconClass}>
            <UserRound />
          </div>
          <SettingsCardContent
            eyebrow="目前帳號"
            title={name}
            description={email}
          >
            <span className="pill green inline-flex items-center gap-1">
              <ShieldCheck size={13} />
              {role === "admin" ? "超級管理員" : "個別使用者"}
            </span>
          </SettingsCardContent>
        </section>
        <section className={cardClass}>
          <div className={`${iconClass} bg-secondary-soft text-green`}>
            <Database />
          </div>
          <SettingsCardContent
            eyebrow="資料庫連線"
            title="Supabase"
            description="quhwzldmtmynahvcdfrj.supabase.co"
          >
            <span className="flex items-center gap-1 text-[11px] text-green">
              <CheckCircle2 className="w-[15px]" />
              連線正常
            </span>
          </SettingsCardContent>
        </section>
        <section className="card col-[1/-1] flex items-center justify-between p-6 max-lg:col-auto max-lg:flex-col max-lg:items-start max-lg:gap-5">
          <div>
            <h2 className="mb-1 mt-0">帳號操作</h2>
            <p className="m-0 text-muted">
              在共用手機或電腦使用完畢後，請記得登出。
            </p>
          </div>
          <button className="outline danger" onClick={logout}>
            <LogOut />
            登出目前帳號
          </button>
        </section>
      </div>
    </DataState>
  );
}

function InventoryDatabaseEditor({
  inventory,
  users,
  onSaved,
}: {
  inventory: { id: string; name: string; ownerIds: string[] };
  users: Array<{ id: string; name: string }>;
  onSaved: () => Promise<unknown>;
}) {
  const [databaseName, setDatabaseName] = useState(inventory.name);
  const [ownerIds, setOwnerIds] = useState(inventory.ownerIds);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (!databaseName.trim() || ownerIds.length === 0) {
      setMessage("請輸入名稱並至少選擇一位擁有者");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(API_ROUTES.getInventoryDatabases, {
        method: inventory.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          inventory.id
            ? { id: inventory.id, name: databaseName.trim(), ownerIds }
            : { name: databaseName.trim(), ownerIds },
        ),
      });
      const result = (await response.json()) as {
        success: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "儲存失敗");
      }
      await onSaved();
      setMessage("已儲存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <label className="block text-[12px] font-semibold">
        資料庫名稱
        <input
          className="mt-2 block w-full rounded-lg border border-line bg-white p-3 text-[14px] outline-none max-lg:text-[16px]"
          value={databaseName}
          maxLength={80}
          onChange={(event) => setDatabaseName(event.target.value)}
        />
      </label>
      <fieldset className="mt-4 border-0 p-0">
        <legend className="text-[12px] font-semibold">擁有者</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {users.map((user) => {
            const checked = ownerIds.includes(user.id);
            return (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[14px]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setOwnerIds((current) =>
                      checked
                        ? current.filter((id) => id !== user.id)
                        : [...current, user.id],
                    )
                  }
                />
                {user.name}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-4 flex items-center gap-3">
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? "儲存中…" : "儲存設定"}
        </button>
        {message && <span className="text-[12px] text-muted">{message}</span>}
      </div>
    </div>
  );
}

function SettingsCardContent({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mb-1 mt-2">{title}</h2>
      <p className="mb-3 mt-0 text-muted max-lg:[overflow-wrap:anywhere]">
        {description}
      </p>
      {children}
    </div>
  );
}
