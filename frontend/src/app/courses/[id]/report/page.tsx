"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken } from "@/lib/useAuthToken";
import { getCourseStudents, type TeacherReport } from "@/lib/api";

export default function CourseReportPage() {
  const params = useParams();
  const courseId = Number(params.id);
  const router = useRouter();
  const token = useAuthToken();
  const [report, setReport] = useState<TeacherReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    getCourseStudents(courseId)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดรายงานไม่สำเร็จ"));
  }, [courseId, token, router]);

  function exportCsv() {
    if (!report) return;
    const header = [
      "rank",
      "name",
      "best_score",
      "best_chapters",
      "accuracy_percent",
      "progress_percent",
      "badges",
      "sessions",
      "completed",
      "last_played",
    ];
    const rows = report.students.map((s) => [
      s.rank,
      `"${s.name.replace(/"/g, '""')}"`,
      s.best_score,
      s.best_chapters,
      s.best_accuracy,
      s.progress_percent,
      s.badges,
      s.sessions,
      s.completed ? "yes" : "no",
      s.last_played ?? "",
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eduquest-report-course-${courseId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold">📊 รายงานผู้เรียน</h1>
            <p className="mt-1 text-sm text-slate-400">
              {report?.course_title ?? "กำลังโหลด..."} · {report?.total_chapters ?? 0} บท
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={!report}
            className="rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:opacity-50"
          >
            ⬇️ ส่งออก CSV
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-rose-300">{error}</div>
        ) : !report ? (
          <div className="h-64 animate-pulse rounded-2xl bg-slate-900/50" />
        ) : (
          <>
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "ผู้เรียน", value: report.summary.students, icon: "👥" },
                { label: "คะแนนเฉลี่ย", value: report.summary.average_score, icon: "⭐" },
                { label: "ความแม่นยำเฉลี่ย", value: `${report.summary.average_accuracy_percent}%`, icon: "🎯" },
                { label: "จบครบ", value: `${report.summary.completion_rate_percent}%`, icon: "✅" },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <p className="text-sm text-slate-400">
                    {card.icon} {card.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{card.value}</p>
                </div>
              ))}
            </div>

            {report.students.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-slate-400">
                ยังไม่มีผู้เล่น — แชร์ลิงก์ให้ผู้เรียนก่อน
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">ชื่อ</th>
                      <th className="px-4 py-3 text-right">คะแนนที่ดีที่สุด</th>
                      <th className="px-4 py-3 text-right">บทที่ผ่าน</th>
                      <th className="px-4 py-3 text-right">ความแม่นยำ</th>
                      <th className="px-4 py-3 text-right">ความคืบหน้า</th>
                      <th className="px-4 py-3 text-right">เหรียญตรา</th>
                      <th className="px-4 py-3 text-right">รอบที่เล่น</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.students.map((student) => (
                      <tr
                        key={student.user_id}
                        className="border-t border-slate-800/60 bg-slate-900/30 hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-3 font-bold text-slate-400">
                          {student.rank === 1 ? "🥇" : student.rank === 2 ? "🥈" : student.rank === 3 ? "🥉" : student.rank}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-200">{student.name}</span>
                          {student.completed && (
                            <span className="ml-2 rounded-full bg-emerald-950/60 px-2 py-0.5 text-[10px] text-emerald-300">
                              จบครบ
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-300">
                          {student.best_score.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {student.best_chapters}/{report.total_chapters}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">{student.best_accuracy}%</td>
                        <td className="px-4 py-3 text-right">
                          <div className="ml-auto flex w-28 items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-indigo-500"
                                style={{ width: `${student.progress_percent}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs text-slate-400">
                              {student.progress_percent}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">{student.badges}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{student.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
