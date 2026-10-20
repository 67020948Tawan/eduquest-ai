"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken } from "@/lib/useAuthToken";
import { getLeaderboard, type Leaderboard } from "@/lib/api";

export default function LeaderboardPage() {
  const params = useParams();
  const courseId = Number(params.id);
  const router = useRouter();
  const token = useAuthToken();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    getLeaderboard(courseId)
      .then(setBoard)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดอันดับไม่สำเร็จ"));
  }, [courseId, token, router]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold">🏆 Leaderboard</h1>
            <p className="mt-1 text-sm text-slate-400">
              อันดับจาก XP สูงสุดต่อผู้เล่น · {board?.total_players ?? 0} ผู้เล่น
            </p>
          </div>
          {board?.my_rank && (
            <div className="rounded-xl border border-indigo-700/50 bg-indigo-950/40 px-4 py-3 text-center">
              <p className="text-xs text-indigo-300">อันดับของคุณ</p>
              <p className="text-2xl font-bold text-indigo-200">#{board.my_rank}</p>
            </div>
          )}
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-rose-300">{error}</div>
        ) : !board ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-900/60" />
            ))}
          </div>
        ) : board.entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-slate-400">
            ยังไม่มีผู้เล่น — แชร์ลิงก์ให้เพื่อนมาแข่งกัน!
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-800">
            {board.entries.map((entry) => (
              <div
                key={`${entry.rank}-${entry.name}`}
                className={`flex items-center gap-4 border-b border-slate-800/60 px-5 py-3 last:border-0 ${
                  entry.is_me ? "bg-indigo-950/40" : "bg-slate-900/30"
                }`}
              >
                <span className="w-10 shrink-0 text-lg font-bold text-slate-400">
                  {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `#${entry.rank}`}
                </span>
                <span className="flex-1 truncate font-medium text-slate-200">
                  {entry.name}
                  {entry.is_me && <span className="ml-2 text-xs text-indigo-400">(คุณ)</span>}
                </span>
                <span className="font-bold text-amber-300">{entry.score.toLocaleString()} XP</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
