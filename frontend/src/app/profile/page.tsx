"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken } from "@/lib/useAuthToken";
import { getMe, getMyProgress, type CurrentUser, type MyProgress } from "@/lib/api";

const PLAN_STYLE: Record<string, { label: string; className: string }> = {
  free: { label: "Free", className: "bg-slate-800 text-slate-300" },
  pro: { label: "Pro", className: "bg-indigo-950/60 text-indigo-300" },
  school: { label: "School", className: "bg-emerald-950/60 text-emerald-300" },
};

export default function ProfilePage() {
  const router = useRouter();
  const token = useAuthToken();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [progress, setProgress] = useState<MyProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    Promise.all([getMe(), getMyProgress()])
      .then(([user, stats]) => {
        setMe(user);
        setProgress(stats);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดโปรไฟล์ไม่สำเร็จ"));
  }, [token, router]);

  const plan = PLAN_STYLE[me?.plan ?? "free"] ?? PLAN_STYLE.free;
  const quotaPercent =
    progress && progress.quota.quota_limit > 0
      ? Math.min(100, Math.round((progress.quota.quota_used / progress.quota.quota_limit) * 100))
      : 0;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← Dashboard
        </Link>

        {error ? (
          <div className="mt-6 rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-rose-300">{error}</div>
        ) : !me || !progress ? (
          <div className="mt-6 h-64 animate-pulse rounded-2xl bg-slate-900/50" />
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-3xl">
                🎓
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-bold">{me.name}</h1>
                <p className="truncate text-sm text-slate-400">{me.email}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${plan.className}`}>
                แผน {plan.label}
              </span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "XP รวม", value: progress.total_xp.toLocaleString(), icon: "⭐" },
                { label: "ความแม่นยำ", value: `${progress.accuracy_percent}%`, icon: "🎯" },
                { label: "ตอบถูก", value: `${progress.total_correct}/${progress.total_answers}`, icon: "✅" },
                { label: "Streak", value: `${progress.current_streak} วัน`, icon: "🔥" },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="text-sm text-slate-400">
                    {card.icon} {card.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold">{card.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-200">🤖 โควต้า AI วันนี้</h2>
                <span className="text-sm text-slate-400">
                  {progress.quota.quota_used}/{progress.quota.quota_limit} ครั้ง
                </span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaPercent >= 100
                      ? "bg-rose-500"
                      : quotaPercent >= 70
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${quotaPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                เหลือ {progress.quota.quota_remaining} ครั้ง · แผน {progress.quota.plan_label} · รีเซ็ตทุกวัน
              </p>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="font-bold text-slate-200">🏅 Badges ({progress.badges.length})</h2>
                {progress.badges.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">ยังไม่มี badges — เรียนให้จบเพื่อปลดล็อก!</p>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {progress.badges.map((badge) => (
                      <div
                        key={`${badge.course_id}-${badge.name}`}
                        className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3"
                      >
                        <p className="text-sm font-semibold text-amber-200">🏅 {badge.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{badge.description}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{badge.course_title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="font-bold text-slate-200">📚 ประวัติการเรียน</h2>
                {progress.sessions.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">ยังไม่มีประวัติ</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {progress.sessions.slice(0, 8).map((session) => (
                      <Link
                        key={session.session_id}
                        href={`/courses/${session.course_id}/preview`}
                        className="block rounded-xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-indigo-700/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-slate-200">
                            {session.course_title ?? `Course #${session.course_id}`}
                          </p>
                          <span className="shrink-0 text-xs font-bold text-amber-300">
                            {session.xp.toLocaleString()} XP
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {session.chapters_completed} chapters · ตอบถูก {session.questions_correct}/
                          {session.questions_answered}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
