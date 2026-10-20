"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken } from "@/lib/useAuthToken";
import {
  createChapter,
  createQuestion,
  deleteChapter,
  deleteQuestion,
  getCourseEditData,
  reorderChapters,
  updateChapter,
  updateCourse,
  updateQuestion,
  type CourseEditData,
  type EditableChapter,
  type EditableQuestion,
  type QuestionInput,
  type QuestionType,
} from "@/lib/api";

const TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "ปรนัย",
  true_false: "จริง/เท็จ",
  matching: "จับคู่",
  ordering: "เรียงลำดับ",
};

const GAME_MODES = [
  { id: "standard_quiz", title: "🧠 Standard Quiz", desc: "แบบทดสอบวัดความเข้าใจ" },
  { id: "rpg_lore", title: "📜 RPG Adventure", desc: "โลกผจญภัย + NPC + เควสต์" },
  { id: "turn_based", title: "⚔️ Turn-Based Combat", desc: "ตอบถูก = โจมตี ตอบผิด = โดนตี" },
  { id: "base_building", title: "🏰 Base Building", desc: "สร้างฐาน สะสมทรัพยากร" },
];

const TYPE_STYLE: Record<QuestionType, string> = {
  multiple_choice: "border-sky-500/30 bg-sky-950/50 text-sky-300",
  true_false: "border-amber-500/30 bg-amber-950/50 text-amber-300",
  matching: "border-fuchsia-500/30 bg-fuchsia-950/50 text-fuchsia-300",
  ordering: "border-emerald-500/30 bg-emerald-950/50 text-emerald-300",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "ง่าย",
  medium: "ปานกลาง",
  hard: "ยาก",
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "border-slate-600 bg-slate-800/80 text-slate-300",
  READY: "border-sky-500/40 bg-sky-950/60 text-sky-300",
  PUBLISHED: "border-emerald-500/40 bg-emerald-950/60 text-emerald-300",
  ARCHIVED: "border-amber-500/40 bg-amber-950/60 text-amber-300",
};

function StatIcon({ path, className }: { path: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const STAT_ICONS = {
  chapter: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  modes: (
    <>
      <line x1="6" x2="10" y1="11" y2="11" />
      <line x1="8" x2="8" y1="9" y2="13" />
      <line x1="15" x2="15.01" y1="12" y2="12" />
      <line x1="18" x2="18.01" y1="10" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5Z" />
    </>
  ),
  readiness: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
} as const;

export default function CourseEditorPage() {
  const params = useParams();
  const courseId = Number(params.id);
  const router = useRouter();
  const token = useAuthToken();
  const [data, setData] = useState<CourseEditData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [courseModes, setCourseModes] = useState<string[]>([]);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [savingCourse, setSavingCourse] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);

  function notify(msg: string, ok = true) {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 2800);
  }

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await getCourseEditData(courseId);
      setData(res);
      setCourseTitle(res.course_title);
      setCourseDescription(res.course_description ?? "");
      setCourseModes(res.game_modes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    }
  }, [courseId]);

  useEffect(() => {
    if (token === null) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    getCourseEditData(courseId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setCourseTitle(res.course_title);
        setCourseDescription(res.course_description ?? "");
        setCourseModes(res.game_modes ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [token, courseId, router]);

  async function handleSaveCourse() {
    if (!data || savingCourse) return;
    if (courseModes.length === 0) {
      notify("เลือกหมวดเกมอย่างน้อย 1 หมวด", false);
      return;
    }
    setSavingCourse(true);
    try {
      await updateCourse(courseId, {
        title: courseTitle.trim(),
        description: courseDescription,
        game_modes: courseModes,
      });
      notify("บันทึกข้อมูลคอร์สแล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", false);
    } finally {
      setSavingCourse(false);
    }
  }

  async function handleAddChapter() {
    if (!newChapterTitle.trim() || addingChapter) return;
    setAddingChapter(true);
    try {
      await createChapter(courseId, newChapterTitle.trim());
      setNewChapterTitle("");
      notify("เพิ่ม Chapter แล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ", false);
    } finally {
      setAddingChapter(false);
    }
  }

  async function handleDeleteChapter(chapter: EditableChapter) {
    if (!window.confirm(`ลบ Chapter "${chapter.title}" และคำถามทั้งหมด?`)) return;
    try {
      await deleteChapter(courseId, chapter.chapter_id);
      notify("ลบ Chapter แล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "ลบไม่สำเร็จ", false);
    }
  }

  async function handleMove(chapter: EditableChapter, direction: -1 | 1) {
    if (!data) return;
    const ids = data.chapters.map((c) => c.chapter_id);
    const index = ids.indexOf(chapter.chapter_id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderChapters(courseId, ids);
      notify("จัดลำดับแล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "จัดลำดับไม่สำเร็จ", false);
    }
  }

  const totalQuestions =
    data?.chapters.reduce((sum, chapter) => sum + chapter.quiz_questions.length, 0) ?? 0;
  const selectedModes = GAME_MODES.filter((mode) => courseModes.includes(mode.id));
  const courseDirty = Boolean(
    data &&
      (courseTitle !== data.course_title ||
        courseDescription !== (data.course_description ?? "") ||
        JSON.stringify([...courseModes].sort()) !== JSON.stringify([...data.game_modes].sort()))
  );
  const statusStyle = data ? STATUS_STYLE[data.status] ?? STATUS_STYLE.DRAFT : STATUS_STYLE.DRAFT;
  const readinessChecks = [
    { label: "ตั้งชื่อคอร์สแล้ว", done: Boolean(courseTitle.trim()) },
    { label: "มีคำอธิบายคอร์ส", done: Boolean(courseDescription.trim()) },
    { label: "เลือกหมวดเกมแล้ว", done: courseModes.length > 0 },
    { label: "มี Chapter อย่างน้อย 1 บท", done: (data?.chapters.length ?? 0) > 0 },
    { label: "มีคำถามอย่างน้อย 1 ข้อ", done: totalQuestions > 0 },
  ];
  const readiness = Math.round(
    (readinessChecks.filter((check) => check.done).length / readinessChecks.length) * 100
  );

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-slate-950 text-slate-100">
      <SiteHeader />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.16),transparent_65%)]" />
      {toast && (
        <div
          className={`eq-pop fixed right-4 top-20 z-[70] flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl ${
            toast.ok
              ? "border-emerald-600/50 bg-emerald-950/85 text-emerald-200"
              : "border-rose-600/50 bg-rose-950/85 text-rose-200"
          }`}
        >
          <span>{toast.ok ? "✓" : "!"}</span>
          {toast.msg}
        </div>
      )}

      <main className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-indigo-500/40 hover:text-indigo-300"
          >
            <span aria-hidden="true">←</span> กลับ Dashboard
          </Link>
          <span className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600 sm:block">
            Course editor · #{courseId}
          </span>
        </div>

        <section className="relative mb-6 overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/70 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-indigo-950/20 sm:p-7">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />

          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-2xl shadow-lg shadow-indigo-950/40">
                ✏️
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-300/80">
                  Course workspace
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
                  แก้ไขเนื้อหา
                </h1>
                <p className="mt-1 max-w-2xl truncate text-sm text-slate-300">
                  {courseTitle || "คอร์สของคุณ"}
                </p>
                {data && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full border px-2.5 py-1 font-bold ${statusStyle}`}>
                      {data.status}
                    </span>
                    <span className="rounded-full border border-slate-700/80 bg-slate-900/60 px-2.5 py-1 text-slate-400">
                      {courseDirty ? "● มีการแก้ไขที่ยังไม่บันทึก" : "✓ ข้อมูลล่าสุดบันทึกแล้ว"}
                    </span>
                    {data.status === "PUBLISHED" && (
                      <span className="rounded-full border border-amber-500/20 bg-amber-950/30 px-2.5 py-1 text-amber-300/90">
                        แก้ไขแล้วต้อง Publish ใหม่
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:flex-col">
              <Link
                href={`/courses/${courseId}/preview`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:border-indigo-400/40 hover:bg-white/10"
              >
                <span aria-hidden="true">▶</span> ดูตัวอย่างเกม
              </Link>
              {courseDirty && (
                <button
                  onClick={handleSaveCourse}
                  disabled={savingCourse || !courseTitle.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingCourse ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
                </button>
              )}
            </div>
          </div>

          <div className="relative mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              {
                icon: STAT_ICONS.chapter,
                tone: "border-indigo-500/25 bg-indigo-500/10 text-indigo-300",
                label: "Chapter",
                value: data?.chapters.length ?? 0,
              },
              {
                icon: STAT_ICONS.question,
                tone: "border-sky-500/25 bg-sky-500/10 text-sky-300",
                label: "คำถาม",
                value: totalQuestions,
              },
              {
                icon: STAT_ICONS.modes,
                tone: "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-300",
                label: "โหมดเกม",
                value: courseModes.length,
              },
              {
                icon: STAT_ICONS.readiness,
                tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
                label: "ความพร้อม",
                value: `${readiness}%`,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-slate-950/40 px-3.5 py-3 backdrop-blur"
              >
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${stat.tone}`}>
                    <StatIcon path={stat.icon} className="h-3.5 w-3.5" />
                  </span>
                  {stat.label}
                </p>
                <p className="mt-1.5 text-xl font-black text-white">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-900/50 bg-rose-950/30 p-6">
            <p className="font-semibold text-rose-200">โหลดข้อมูลคอร์สไม่สำเร็จ</p>
            <p className="mt-1 text-sm text-rose-300/80">{error}</p>
            <p className="mt-2 text-xs text-rose-300/60">
              เซิร์ฟเวอร์อาจกำลังตื่นอยู่ ลองอีกครั้งได้เลย
            </p>
            <button
              onClick={load}
              className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-400/50 hover:bg-rose-500/20"
            >
              ลองอีกครั้ง
            </button>
          </div>
        ) : !data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="h-80 animate-pulse rounded-2xl bg-slate-900/50" />
            <div className="h-56 animate-pulse rounded-2xl bg-slate-900/50" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
            <aside className="order-last space-y-4 lg:order-2 lg:sticky lg:top-24">
              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-slate-950/20">
                <div className="border-b border-slate-800 bg-slate-900/70 px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white">ความพร้อมของคอร์ส</h2>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        readiness === 100
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-indigo-500/15 text-indigo-300"
                      }`}
                    >
                      {readiness}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        readiness === 100
                          ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                          : "bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                      }`}
                      style={{ width: `${readiness}%` }}
                    />
                  </div>
                </div>
                <ul className="space-y-2.5 px-5 py-4">
                  {readinessChecks.map((check) => (
                    <li key={check.label} className="flex items-center gap-2.5 text-xs">
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                          check.done
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-slate-700 bg-slate-950 text-slate-600"
                        }`}
                      >
                        {check.done ? "✓" : "·"}
                      </span>
                      <span className={check.done ? "text-slate-300" : "text-slate-500"}>
                        {check.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-slate-800 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
                  {readiness === 100
                    ? "ครบทุกขั้นตอนแล้ว พร้อมเปิดให้นักเรียนเล่น"
                    : "ทำรายการที่ยังว่างเพื่อให้คอร์สพร้อมใช้งาน"}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-200">โหมดเกมที่เลือก</p>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                    {courseModes.length}
                  </span>
                </div>
                {selectedModes.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selectedModes.map((mode) => (
                      <span
                        key={mode.id}
                        className="rounded-lg border border-emerald-500/20 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-medium text-emerald-200"
                      >
                        {mode.title}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2.5 text-xs text-amber-300">
                    ยังไม่ได้เลือกโหมดเกม
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <p className="text-sm font-bold text-slate-200">ทางลัด</p>
                <div className="mt-3 space-y-1.5">
                  <a
                    href="#add-chapter"
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300 transition hover:border-emerald-500/30 hover:text-emerald-300"
                  >
                    <span>+ เพิ่ม Chapter ใหม่</span>
                    <span aria-hidden="true">↓</span>
                  </a>
                  <Link
                    href={`/courses/${courseId}/preview`}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300 transition hover:border-indigo-500/30 hover:text-indigo-300"
                  >
                    <span>▶ ทดลองเล่นเกม</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    href="/dashboard"
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-600 hover:text-white"
                  >
                    <span>← กลับ Dashboard</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
                <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
                  กดชื่อ Chapter เพื่อเปิด/ปิดการแก้ไข · ใช้ ↑ ↓ เพื่อสลับลำดับ
                </p>
              </div>
            </aside>

            <div className="order-first min-w-0 space-y-6 lg:order-1">
              <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl shadow-slate-950/20">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/70 px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-xs font-black text-indigo-300">
                      1
                    </span>
                    <div>
                      <h2 className="font-bold text-white">ข้อมูลคอร์ส</h2>
                      <p className="mt-0.5 text-xs text-slate-500">ชื่อ คำอธิบาย และรูปแบบการเล่น</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      courseDirty
                        ? "border-amber-500/30 bg-amber-950/40 text-amber-300"
                        : "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                    }`}
                  >
                    {courseDirty ? "● ยังไม่บันทึก" : "✓ บันทึกแล้ว"}
                  </span>
                </div>

                <div className="space-y-6 p-5 sm:p-6">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-300">
                      ชื่อคอร์ส <span className="text-rose-400">*</span>
                    </span>
                    <input
                      value={courseTitle}
                      onChange={(e) => setCourseTitle(e.target.value)}
                      placeholder="เช่น ความรู้พื้นฐานด้านความปลอดภัยไซเบอร์"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-300">
                      <span>คำอธิบาย</span>
                      <span className="font-normal text-slate-600">{courseDescription.length} ตัวอักษร</span>
                    </span>
                    <textarea
                      value={courseDescription}
                      onChange={(e) => setCourseDescription(e.target.value)}
                      placeholder="อธิบายว่าใครควรเรียน และจะได้อะไรจากคอร์สนี้"
                      rows={4}
                      className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm leading-relaxed outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>

                  <div>
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-300">หมวดเกม</p>
                        <p className="mt-0.5 text-xs text-slate-500">เลือกได้มากกว่า 1 หมวด</p>
                      </div>
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                        {courseModes.length} เลือกแล้ว
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {GAME_MODES.map((mode) => {
                        const on = courseModes.includes(mode.id);
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setCourseModes((prev) =>
                                prev.includes(mode.id)
                                  ? prev.filter((m) => m !== mode.id)
                                  : [...prev, mode.id]
                              )
                            }
                            className={`group relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 ${
                              on
                                ? "border-emerald-400/50 bg-gradient-to-br from-emerald-950/60 to-slate-950 shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-400/20"
                                : "border-slate-700/80 bg-slate-950/60 hover:-translate-y-0.5 hover:border-indigo-400/40 hover:bg-slate-900"
                            }`}
                          >
                            <span
                              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold transition ${
                                on
                                  ? "border-emerald-400 bg-emerald-500 text-slate-950"
                                  : "border-slate-600 text-transparent group-hover:border-indigo-400"
                              }`}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className={`block text-sm font-bold ${on ? "text-emerald-100" : "text-slate-200"}`}>
                                  {mode.title}
                                </span>
                                {on && (
                                  <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                    เลือกแล้ว
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">{mode.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-300">
                        การแก้ไขจะมีผลกับการเล่นครั้งถัดไป
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        ตรวจสอบชื่อ คำอธิบาย และหมวดเกมก่อนบันทึก
                      </p>
                    </div>
                    <button
                      onClick={handleSaveCourse}
                      disabled={savingCourse || !courseTitle.trim() || !courseDirty}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/40 transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 disabled:opacity-60"
                    >
                      {savingCourse ? "กำลังบันทึก..." : courseDirty ? "บันทึกการเปลี่ยนแปลง" : "✓ บันทึกแล้ว"}
                    </button>
                  </div>
                </div>
              </section>

              <section id="add-chapter" className="scroll-mt-24 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 text-xs font-black text-fuchsia-300">
                      2
                    </span>
                    <div>
                      <h2 className="text-lg font-bold text-white">เนื้อหาและคำถาม</h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {data.chapters.length} Chapter · {totalQuestions} คำถาม
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-slate-700 bg-gradient-to-br from-slate-900/70 to-slate-950 p-4">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/10 text-sm text-emerald-300">
                      +
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-200">เพิ่ม Chapter ใหม่</p>
                      <p className="text-[11px] text-slate-500">ตั้งชื่อบท ثمค่อยเพิ่มเนื้อหาและคำถาม</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newChapterTitle}
                      onChange={(e) => setNewChapterTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddChapter();
                      }}
                      placeholder="ชื่อ Chapter ใหม่"
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                    <button
                      onClick={handleAddChapter}
                      disabled={addingChapter || !newChapterTitle.trim()}
                      className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {addingChapter ? "กำลังเพิ่ม..." : "+ เพิ่ม Chapter"}
                    </button>
                  </div>
                </div>

                {data.chapters.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-6 py-12 text-center">
                    <p className="text-3xl">📚</p>
                    <p className="mt-3 font-semibold text-slate-200">ยังไม่มี Chapter</p>
                    <p className="mt-1 text-sm text-slate-500">เพิ่ม Chapter แรกเพื่อเริ่มสร้างเนื้อหา</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.chapters.map((chapter, index) => (
                      <ChapterEditor
                        key={chapter.chapter_id}
                        courseId={courseId}
                        chapter={chapter}
                        index={index}
                        total={data.chapters.length}
                        onMove={handleMove}
                        onDelete={handleDeleteChapter}
                        notify={notify}
                        reload={load}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ChapterEditor({
  courseId,
  chapter,
  index,
  total,
  onMove,
  onDelete,
  notify,
  reload,
}: {
  courseId: number;
  chapter: EditableChapter;
  index: number;
  total: number;
  onMove: (chapter: EditableChapter, direction: -1 | 1) => void;
  onDelete: (chapter: EditableChapter) => void;
  notify: (msg: string, ok?: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [title, setTitle] = useState(chapter.title);
  const [lessonTitle, setLessonTitle] = useState(chapter.lesson.title);
  const [objective, setObjective] = useState(chapter.lesson.objective);
  const [content, setContent] = useState(chapter.lesson.content);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState(index === 0);

  async function saveChapter() {
    setSaving(true);
    try {
      await updateChapter(courseId, chapter.chapter_id, {
        title: title.trim(),
        lesson_title: lessonTitle,
        lesson_objective: objective,
        lesson_content: content,
      });
      notify("บันทึก Chapter แล้ว");
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", false);
    } finally {
      setSaving(false);
    }
  }

  async function removeQuestion(question: EditableQuestion) {
    if (!window.confirm("ลบคำถามข้อนี้?")) return;
    try {
      await deleteQuestion(courseId, question.id);
      notify("ลบคำถามแล้ว");
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "ลบไม่สำเร็จ", false);
    }
  }

  return (
    <details
      className="group overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 transition-all open:border-indigo-500/50 open:bg-slate-900/80 open:shadow-xl open:shadow-indigo-950/20"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex list-none cursor-pointer select-none items-center gap-3 p-4 transition hover:bg-slate-900/70 sm:p-5 [&::-webkit-details-marker]:hidden">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/10 text-xs font-black text-indigo-300">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold leading-snug text-slate-100">{chapter.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-400">
              {chapter.quiz_questions.length} คำถาม
            </span>
            {chapter.lesson.title && (
              <>
                <span>·</span>
                <span className="truncate">{chapter.lesson.title}</span>
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="เลื่อน Chapter ขึ้น"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMove(chapter, -1);
            }}
            disabled={index === 0}
            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-700 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="เลื่อน Chapter ลง"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMove(chapter, 1);
            }}
            disabled={index === total - 1}
            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-700 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="ลบ Chapter"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(chapter);
            }}
            className="grid h-7 w-7 place-items-center rounded-lg border border-rose-900/60 text-xs text-rose-400 transition hover:bg-rose-950/40"
          >
            ✕
          </button>
          <span className="ml-1 grid h-7 w-7 place-items-center text-slate-500 transition group-open:rotate-180">
            ▾
          </span>
        </span>
      </summary>

      <div className="border-t border-slate-800 p-4 sm:p-5">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">รายละเอียดบท</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-400">ชื่อ Chapter</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ชื่อ Chapter"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-400">ชื่อบทเรียน</span>
              <input
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="ชื่อบทเรียน"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">จุดประสงค์การเรียนรู้</span>
            <input
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="ผู้เรียนจะได้อะไรจากบทนี้"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-400">เนื้อหาบทเรียน</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="เนื้อหาบทเรียน"
              rows={6}
              className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-indigo-500"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500">{content.length} ตัวอักษร</p>
            <button
              onClick={saveChapter}
              disabled={saving || !title.trim()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก..." : "บันทึก Chapter"}
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-200">
              คำถาม <span className="font-normal text-slate-500">({chapter.quiz_questions.length})</span>
            </h3>
            <button
              onClick={() => {
                setAdding((v) => !v);
                setEditingId(null);
              }}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              {adding ? "ปิดฟอร์ม" : "+ เพิ่มคำถาม"}
            </button>
          </div>

          {chapter.quiz_questions.length === 0 && !adding && (
            <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-500">
              ยังไม่มีคำถามใน Chapter นี้
            </p>
          )}

          {chapter.quiz_questions.map((question) => (
            <div
              key={question.id}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5 transition hover:border-slate-700"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TYPE_STYLE[question.question_type]}`}>
                      {TYPE_LABEL[question.question_type]}
                    </span>
                    <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {DIFFICULTY_LABEL[question.difficulty] ?? question.difficulty}
                    </span>
                    <span className="text-[10px] text-slate-500">{question.points} XP</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-200">{question.question}</p>
                  <p className="rounded-lg bg-emerald-950/20 px-2 py-1 text-[11px] leading-relaxed text-emerald-400/90">
                    {question.question_type === "multiple_choice" || question.question_type === "true_false" ? (
                      <>เฉลย: {question.options[question.correct_answer_index]}</>
                    ) : question.question_type === "matching" ? (
                      <>
                        เฉลย:{" "}
                        {(question.matching_pairs ?? [])
                          .map((pair) => `${pair.left} → ${pair.right}`)
                          .join(", ")}
                      </>
                    ) : (
                      <>เฉลย: {(question.ordering_items ?? []).join(" → ")}</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button
                    onClick={() => {
                      setEditingId(editingId === question.id ? null : question.id);
                      setAdding(false);
                    }}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    {editingId === question.id ? "ปิด" : "แก้ไข"}
                  </button>
                  <button
                    onClick={() => removeQuestion(question)}
                    className="rounded-lg border border-rose-900/60 px-2 py-1 text-xs text-rose-400 transition hover:bg-rose-950/40"
                  >
                    ลบ
                  </button>
                </div>
              </div>

              {editingId === question.id && (
                <QuestionForm
                  initial={question}
                  submitLabel="บันทึกคำถาม"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (payload) => {
                    await updateQuestion(courseId, question.id, payload);
                    notify("บันทึกคำถามแล้ว");
                    setEditingId(null);
                    await reload();
                  }}
                />
              )}
            </div>
          ))}

          {adding && (
            <QuestionForm
              submitLabel="เพิ่มคำถาม"
              onCancel={() => setAdding(false)}
              onSubmit={async (payload) => {
                await createQuestion(courseId, chapter.chapter_id, payload);
                notify("เพิ่มคำถามแล้ว");
                setAdding(false);
                await reload();
              }}
            />
          )}
        </div>
      </div>
    </details>
  );
}

function QuestionForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: EditableQuestion;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (payload: QuestionInput) => Promise<void>;
}) {
  const [type, setType] = useState<QuestionType>(initial?.question_type ?? "multiple_choice");
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [options, setOptions] = useState<string[]>(
    initial?.options?.length ? initial.options : ["", "", "", ""]
  );
  const [correctIndex, setCorrectIndex] = useState(initial?.correct_answer_index ?? 0);
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "easy");
  const [points, setPoints] = useState(initial?.points ?? 50);
  const [pairs, setPairs] = useState<Array<{ left: string; right: string }>>(
    initial?.matching_pairs?.length ? initial.matching_pairs : [
      { left: "", right: "" },
      { left: "", right: "" },
    ]
  );
  const [items, setItems] = useState<string[]>(
    initial?.ordering_items?.length ? initial.ordering_items : ["", "", ""]
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function setOption(index: number, value: string) {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
    setCorrectIndex((prev) => (prev === index ? 0 : prev > index ? prev - 1 : prev));
  }

  function removePair(index: number) {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const base = {
      question: question.trim(),
      explanation: explanation.trim(),
      difficulty,
      points: Number(points) || 50,
    };
    let payload: QuestionInput;
    if (type === "matching") {
      const cleaned = pairs.filter((p) => p.left.trim() && p.right.trim());
      if (cleaned.length < 2) {
        setFormError("ต้องมีคู่อย่างน้อย 2 คู่");
        return;
      }
      payload = { ...base, question_type: type, matching_pairs: cleaned };
    } else if (type === "ordering") {
      const cleaned = items.map((i) => i.trim()).filter(Boolean);
      if (cleaned.length < 2) {
        setFormError("ต้องมีอย่างน้อย 2 รายการ");
        return;
      }
      payload = { ...base, question_type: type, ordering_items: cleaned };
    } else {
      const cleaned = options.map((o) => o.trim()).filter(Boolean);
      if (cleaned.length < 2) {
        setFormError("ต้องมีตัวเลือกอย่างน้อย 2 ข้อ");
        return;
      }
      const safeIndex = Math.min(correctIndex, cleaned.length - 1);
      payload = {
        ...base,
        question_type: type,
        options: cleaned,
        correct_answer_index: safeIndex,
      };
    }

    if (!payload.question) {
      setFormError("กรุณากรอกคำถาม");
      return;
    }

    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20";
  const removeButtonClass =
    "grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-rose-900/60 text-xs text-rose-400 transition hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-xl border border-indigo-900/40 bg-slate-950/60 p-4"
    >
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-300">ประเภทคำถาม</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                if (t === "true_false") setCorrectIndex(0);
              }}
              className={`rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                type === t
                  ? "border-indigo-400 bg-indigo-600 text-white"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
              }`}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-400">ความยาก</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className={inputClass}
          >
            <option value="easy">ง่าย</option>
            <option value="medium">ปานกลาง</option>
            <option value="hard">ยาก</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-400">คะแนน (XP)</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className={inputClass}
            placeholder="50"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-slate-400">
          คำถาม <span className="text-rose-400">*</span>
        </span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="พิมพ์คำถามที่ต้องการถามผู้เรียน"
          rows={2}
          className={inputClass}
        />
      </label>

      {type === "matching" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">คู่ที่ถูกต้อง</p>
            <p className="text-[11px] text-slate-500">อย่างน้อย 2 คู่</p>
          </div>
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-800 text-[10px] font-bold text-slate-400">
                {i + 1}
              </span>
              <input
                value={pair.left}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, idx) => (idx === i ? { ...p, left: e.target.value } : p))
                  )
                }
                placeholder="ด้านซ้าย"
                className={`${inputClass} min-w-0 flex-1`}
              />
              <span className="shrink-0 text-xs text-slate-500">→</span>
              <input
                value={pair.right}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, idx) => (idx === i ? { ...p, right: e.target.value } : p))
                  )
                }
                placeholder="ด้านขวา"
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                aria-label={`ลบคู่ที่ ${i + 1}`}
                onClick={() => removePair(i)}
                disabled={pairs.length <= 2}
                className={removeButtonClass}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPairs((prev) => [...prev, { left: "", right: "" }])}
            className="text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
          >
            + เพิ่มคู่
          </button>
        </div>
      ) : type === "ordering" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">ลำดับที่ถูกต้อง</p>
            <p className="text-[11px] text-slate-500">เรียงจากบนลงล่าง</p>
          </div>
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-800 text-[10px] font-bold text-slate-400">
                {i + 1}
              </span>
              <input
                value={item}
                onChange={(e) =>
                  setItems((prev) => prev.map((it, idx) => (idx === i ? e.target.value : it)))
                }
                placeholder={`รายการที่ ${i + 1}`}
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                aria-label={`ลบรายการที่ ${i + 1}`}
                onClick={() => removeItem(i)}
                disabled={items.length <= 2}
                className={removeButtonClass}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, ""])}
            className="text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
          >
            + เพิ่มรายการ
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">
              ตัวเลือก {type === "multiple_choice" && <span className="font-normal text-slate-500">(เลือกข้อถูก)</span>}
            </p>
            {type === "multiple_choice" && (
              <p className="text-[11px] text-slate-500">อย่างน้อย 2 ข้อ</p>
            )}
          </div>
          {(type === "true_false" ? options.slice(0, 2) : options).map((option, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-xl border p-2 transition ${
                correctIndex === i
                  ? "border-emerald-500/50 bg-emerald-950/20"
                  : "border-slate-800 bg-slate-900/40"
              }`}
            >
              <input
                type="radio"
                name={`correct-${initial?.id ?? "new"}`}
                checked={correctIndex === i}
                onChange={() => setCorrectIndex(i)}
                className="h-4 w-4 shrink-0 accent-emerald-500"
                aria-label={`ตั้งตัวเลือกที่ ${i + 1} เป็นคำตอบที่ถูก`}
              />
              <input
                value={option}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={
                  type === "true_false" ? (i === 0 ? "จริง" : "เท็จ") : `ตัวเลือก ${i + 1}`
                }
                className={`${inputClass} min-w-0 flex-1`}
              />
              {type === "multiple_choice" && (
                <button
                  type="button"
                  aria-label={`ลบตัวเลือกที่ ${i + 1}`}
                  onClick={() => removeOption(i)}
                  disabled={options.length <= 2}
                  className={removeButtonClass}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {type === "multiple_choice" && (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
            >
              + เพิ่มตัวเลือก
            </button>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-slate-400">
          คำอธิบายเฉลย <span className="font-normal text-slate-600">(ไม่บังคับ)</span>
        </span>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="อธิบายว่าทำไมคำตอบนี้ถึงถูก"
          rows={2}
          className={inputClass}
        />
      </label>

      {formError && (
        <p className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
