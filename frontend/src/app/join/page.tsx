"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { resolveJoinCode } from "@/lib/api";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length !== 6) {
      setError("รหัสต้องมี 6 ตัวอักษร");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await resolveJoinCode(normalized);
      router.push(res.share_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่พบห้องเรียนรหัสนี้");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16">
        <p className="text-5xl">🎟️</p>
        <h1 className="mt-4 text-2xl font-bold">เข้าห้องเรียนด้วยรหัส</h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          ครูจะให้รหัส 6 หลักมา (เช่น K7Q2XD)
          <br />
          กรอกแล้วกดเข้าเล่นได้ทันที ไม่ต้องสมัครสมาชิก
        </p>

        <form onSubmit={handleSubmit} className="mt-8 w-full">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
            placeholder="K7Q2XD"
            autoComplete="off"
            spellCheck={false}
            aria-label="รหัสเข้าห้อง 6 หลัก"
            className="w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 py-4 text-center font-mono text-3xl font-black tracking-[0.3em] text-amber-200 outline-none transition placeholder:text-slate-700 focus:border-amber-500"
          />

          {error && (
            <p className="mt-3 rounded-lg border border-rose-900/50 bg-rose-950/40 px-4 py-2.5 text-sm text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-4 text-lg font-bold text-slate-950 transition hover:from-amber-400 disabled:opacity-60"
          >
            {busy ? "กำลังค้นหาห้อง..." : "🚀 เข้าเล่นเลย"}
          </button>
        </form>

        <Link href="/" className="mt-8 text-sm text-slate-500 hover:text-indigo-400">
          ← กลับหน้าแรก
        </Link>
      </main>
    </div>
  );
}
