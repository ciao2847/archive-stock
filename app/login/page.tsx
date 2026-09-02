"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) { setError(error.message === "Invalid login credentials" ? "Email 或密碼不正確" : error.message); setLoading(false); return; }
    router.replace("/"); router.refresh();
  }

  return <main className="login-page grid min-h-screen place-items-center p-5"><section className="w-full max-w-[420px] rounded-[12px] bg-[var(--color-paper)] p-[38px] shadow-[0_25px_80px_rgba(0,0,0,0.05)] max-sm:px-[22px] max-sm:py-7 [&>h1]:my-2 [&>h1]:text-[30px] [&>p]:mb-[25px] [&>p]:mt-0 [&>p]:text-[var(--color-muted)]">
    <BrandLogo className="mb-[34px]" preload size="large" />
    <span className="eyebrow">內部管理系統</span><h1>登入工作台</h1><p>使用 Supabase 建立的內部帳號登入。</p>
    <form className="[&_label]:my-[14px] [&_label]:block [&_label]:text-[12px] [&_label]:font-semibold [&_input]:mt-[7px] [&_input]:block [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--color-line)] [&_input]:bg-[var(--color-white)] [&_input]:p-3 [&_input]:text-[14px] [&_input]:outline-none max-lg:[&_input]:text-[16px] [&_.primary]:mt-[10px] [&_.primary]:w-full [&_.primary]:p-[13px]" onSubmit={login}><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label><label>密碼<input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 個字元" /></label>{error && <div className="login-error">{error}</div>}<button className="primary" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <LogIn />}{loading ? "登入中…" : "登入"}</button></form>
  </section></main>;
}
