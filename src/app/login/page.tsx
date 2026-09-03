"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { BrandLogo } from "@/components/BrandLogo";
import {
  FormInput,
  FormLabel,
  FormPrimaryButton,
} from "@/components/FormControls";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Email 或密碼不正確"
          : error.message,
      );
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-page grid min-h-screen place-items-center p-5">
      <section className="w-full max-w-[420px] rounded-[12px] bg-paper p-10 shadow-[0_25px_80px_rgba(0,0,0,0.05)] max-sm:px-6 max-sm:py-7">
        <BrandLogo className="mb-9" preload size="large" />
        <span className="eyebrow">內部管理系統</span>
        <h1 className="my-2 text-[30px]">登入工作台</h1>
        <p className="mb-6 mt-0 text-muted">
          使用 Supabase 建立的內部帳號登入。
        </p>
        <form onSubmit={login}>
          <FormLabel>
            Email
            <FormInput
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </FormLabel>
          <FormLabel>
            密碼
            <FormInput
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 個字元"
            />
          </FormLabel>
          {error && <div className="login-error">{error}</div>}
          <FormPrimaryButton disabled={loading}>
            {loading ? <LoaderCircle className="spin" /> : <LogIn />}
            {loading ? "登入中…" : "登入"}
          </FormPrimaryButton>
        </form>
      </section>
    </main>
  );
}
