"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import {
  demoLogin,
  hasQuickLogin,
  loginRequest,
  quickTeacherLogin,
  registerRequest,
} from "@/lib/api";

// ปุ่ม Demo แสดงเฉพาะตอน dev ในเครื่องครู — production ต้องไม่โชว์
// (ทุกคนกด Demo = ใช้บัญชีเดียวกัน = เล่นทับ session เดียวกัน)
const SHOW_DEMO = process.env.NODE_ENV !== "production";
// ปุ่มครูล็อกอินอัตโนมัติ — แสดงเมื่อตั้ง env NEXT_PUBLIC_QUICK_LOGIN_* ไว้
const SHOW_QUICK = hasQuickLogin();

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Lazy init จาก URL — ไม่ต้อง setState ใน effect
  const [mode, setMode] = useState<"login" | "register">(() => {
    if (typeof window === "undefined") return "login";
    return new URLSearchParams(window.location.search).get("mode") === "register"
      ? "register"
      : "login";
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [demoPending, setDemoPending] = useState(false);

  // ?demo=1 → auto demo login (setState ทั้งหมดอยู่ใน async callback)
  useEffect(() => {
    if (!SHOW_DEMO || searchParams.get("demo") !== "1") return;
    let cancelled = false;
    demoLogin().then((ok) => {
      if (cancelled) return;
      if (ok) {
        router.push("/dashboard");
      } else {
        setError("เข้า Demo ไม่สำเร็จ กรุณาลองอีกครั้ง");
        setDemoPending(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setManualBusy(true);
    try {
      if (mode === "register") {
        await registerRequest(name.trim(), email.trim(), password);
      }
      await loginRequest(email.trim(), password);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setManualBusy(false);
    }
  }

  async function handleDemo() {
    setError(null);
    setManualBusy(true);
    const ok = await demoLogin();
    if (ok) {
      router.push("/dashboard");
    } else {
      setError("เข้า Demo ไม่สำเร็จ — Backend เปิดอยู่ไหม?");
      setManualBusy(false);
    }
  }

  async function handleQuick() {
    setError(null);
    setManualBusy(true);
    const ok = await quickTeacherLogin();
    if (ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError("เข้าสู่ระบบครูไม่สำเร็จ — ลองใหม่ หรือล็อกอินเอง");
      setManualBusy(false);
    }
  }

  const busy = manualBusy || demoPending;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
          {/* Tabs */}
          <div className="mb-8 grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                  mode === m ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {m === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">ชื่อ</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ครูสมหวัง"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">อีเมล</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@school.ac.th"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">รหัสผ่าน</label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-rose-900/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 py-3.5 font-bold text-white transition hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500"
            >
              {busy
                ? "กำลังประมวลผล..."
                : mode === "login"
                  ? "เข้าสู่ระบบ"
                  : "สมัครสมาชิกและเข้าใช้งาน"}
            </button>
          </form>

          {(SHOW_QUICK || SHOW_DEMO) && (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-slate-600">
                <span className="h-px flex-1 bg-slate-800" />
                หรือ
                <span className="h-px flex-1 bg-slate-800" />
              </div>

              <button
                onClick={SHOW_QUICK ? handleQuick : handleDemo}
                disabled={busy}
                className="w-full rounded-lg border border-emerald-800/60 bg-emerald-950/30 py-3 font-medium text-emerald-400 transition hover:bg-emerald-950/60 disabled:opacity-50"
              >
                {SHOW_QUICK
                  ? "👩‍🏫 ครู — เข้าสู่ระบบอัตโนมัติ"
                  : "🎮 เข้าใช้งานด้วย Demo Account"}
              </button>
            </>
          )}

          <Link
            href="/join"
            className="mt-3 block w-full rounded-lg border border-amber-800/60 bg-amber-950/20 py-3 text-center font-medium text-amber-300 transition hover:bg-amber-950/40"
          >
            🎟️ นักเรียนมีรหัสเข้าห้อง? กดที่นี่
          </Link>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/" className="hover:text-indigo-400">← กลับหน้าแรก</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <Suspense fallback={<div className="flex flex-1 items-center justify-center">กำลังโหลด...</div>}>
        <LoginInner />
      </Suspense>
    </div>
  );
}
