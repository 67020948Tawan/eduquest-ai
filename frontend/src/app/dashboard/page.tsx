"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import ShareModal from "@/components/ShareModal";
import { useAuthToken } from "@/lib/useAuthToken";
import {
  listCourses,
  deleteCourse,
  publishGame,
  type CourseSummary,
} from "@/lib/api";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "📝 Draft", className: "bg-slate-800 text-slate-300" },
  GENERATING: { label: "⏳ Generating", className: "bg-amber-950/60 text-amber-300" },
  READY: { label: "✅ Ready", className: "bg-emerald-950/60 text-emerald-300" },
  PUBLISHED: { label: "🚀 Live", className: "bg-indigo-950/60 text-indigo-300" },
  ARCHIVED: { label: "📦 Archived", className: "bg-slate-900 text-slate-500" },
};

export default function DashboardPage() {
  const router = useRouter();
  const token = useAuthToken();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Publish / Share
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareTitle, setShareTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function notify(msg: string, ok: boolean) {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    if (token === null) return;
    listCourses()
      .then(setCourses)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (token === null) router.replace("/login");
  }, [token, router]);

  async function handleDelete(e: React.MouseEvent, courseId: number, title: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`ลบคอร์ส "${title}" ใช่ไหม? ข้อมูลทั้งหมดจะหายและกู้คืนไม่ได้`)) return;
    setDeletingId(courseId);
    try {
      await deleteCourse(courseId);
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePublish(course: CourseSummary) {
    setBusy(true);
    setPublishingId(course.id);
    try {
      const res = await publishGame(course.id, "unlisted");
      setCourses((prev) =>
        prev.map((c) => (c.id === course.id ? { ...c, status: "PUBLISHED" } : c))
      );
      setSharePath(res.share_path);
      setShareCode(res.share_code ?? null);
      setShareTitle(course.title);
      notify("🎉 เผยแพร่เกมสำเร็จ!", true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Publish ไม่สำเร็จ", false);
    } finally {
      setBusy(false);
      setPublishingId(null);
    }
  }

  if (token === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        กำลังตรวจสอบการเข้าสู่ระบบ...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      {/* Toast */}
      {toast && (
        <div
          className={`eq-pop fixed right-4 top-20 z-[70] rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl backdrop-blur ${
            toast.ok
              ? "border-emerald-600/50 bg-emerald-950/85 text-emerald-200"
              : "border-rose-600/50 bg-rose-950/85 text-rose-200"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Welcome back 👋</h1>
          <p className="mt-1 text-slate-400">Create something amazing today.</p>
          <Link
            href="/courses/create"
            className="mt-4 inline-block rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 font-semibold shadow-lg shadow-indigo-950/50 transition hover:from-indigo-500 hover:to-violet-500"
          >
            + Create Game
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-rose-300">{error}</div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 p-16 text-center">
            <p className="text-5xl">🎮</p>
            <h2 className="mt-4 text-xl font-bold">No games yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
              Turn your first lesson into an interactive game.
            </p>
            <Link
              href="/courses/create"
              className="mt-6 inline-block rounded-xl bg-indigo-600 px-6 py-3 font-semibold transition hover:bg-indigo-500"
            >
              ✨ Create Game
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => {
              const st = STATUS_STYLE[course.status] ?? STATUS_STYLE.DRAFT;
              const published = course.status === "PUBLISHED";
              return (
                <div
                  key={course.id}
                  className="group relative flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/60 hover:shadow-lg hover:shadow-indigo-950/40"
                >
                  <button
                    onClick={(e) => handleDelete(e, course.id, course.title)}
                    disabled={deletingId === course.id}
                    title="ลบคอร์สนี้"
                    aria-label={`ลบคอร์ส ${course.title}`}
                    className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-600 opacity-0 transition hover:bg-rose-950 hover:text-rose-400 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {deletingId === course.id ? "..." : "🗑"}
                  </button>

                  <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${st.className}`}>
                    {st.label}
                  </span>

                  <Link href={`/courses/${course.id}/preview`} className="mt-3 block">
                    <h2 className="line-clamp-1 pr-8 text-lg font-bold group-hover:text-indigo-300">{course.title}</h2>
                  </Link>
                  <p className="mt-1 line-clamp-2 flex-1 text-sm text-slate-400">
                    {course.description || "ไม่มีคำอธิบาย"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(course.game_modes ?? []).slice(0, 3).map((m) => (
                      <span key={m} className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
                        {m.replace("_", " ")}
                      </span>
                    ))}
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
                      🎨 {course.visual_style.replace("_", " ")}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Link
                      href={`/courses/${course.id}/preview`}
                      className="rounded-lg bg-slate-800 py-2 text-center text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                    >
                      ▶ Open
                    </Link>
                    {published ? (
                      <button
                        onClick={() => {
                          // refetch share info ผ่าน publish idempotent
                          handleShareExisting(course);
                        }}
                        disabled={busy}
                        className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-pink-600 py-2 text-xs font-bold text-white transition hover:from-fuchsia-500 disabled:opacity-50"
                      >
                        🔗 Share
                      </button>
                    ) : course.status === "READY" || course.status === "DRAFT" ? (
                      <button
                        onClick={() => handlePublish(course)}
                        disabled={busy || publishingId === course.id}
                        className="rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {publishingId === course.id ? "..." : "🌐 Publish"}
                      </button>
                    ) : (
                      <span />
                    )}
                    <span />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {sharePath && (
        <ShareModal
          title={shareTitle}
          sharePath={sharePath}
          shareCode={shareCode}
          onClose={() => {
            setSharePath(null);
            setShareCode(null);
          }}
        />
      )}
    </div>
  );

  async function handleShareExisting(course: CourseSummary) {
    setBusy(true);
    try {
      const res = await publishGame(course.id, "unlisted"); // idempotent — ได้ token เดิมกลับมา
      setSharePath(res.share_path);
      setShareCode(res.share_code ?? null);
      setShareTitle(course.title);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Share ไม่สำเร็จ", false);
    } finally {
      setBusy(false);
    }
  }
}
