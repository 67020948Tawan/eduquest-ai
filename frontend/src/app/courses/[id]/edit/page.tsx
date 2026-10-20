"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [busy, setBusy] = useState(false);

  function notify(msg: string, ok = true) {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 2800);
  }

  const load = useCallback(async () => {
    try {
      const res = await getCourseEditData(courseId);
      setData(res);
      setCourseTitle(res.course_title);
      setCourseDescription(res.course_description ?? "");
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
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [token, courseId, router]);

  async function handleSaveCourse() {
    if (!data || busy) return;
    setBusy(true);
    try {
      await updateCourse(courseId, {
        title: courseTitle.trim(),
        description: courseDescription,
      });
      notify("บันทึกข้อมูลคอร์สแล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", false);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddChapter() {
    if (!newChapterTitle.trim() || busy) return;
    setBusy(true);
    try {
      await createChapter(courseId, newChapterTitle.trim());
      setNewChapterTitle("");
      notify("เพิ่ม Chapter แล้ว");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ", false);
    } finally {
      setBusy(false);
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      {toast && (
        <div
          className={`eq-pop fixed right-4 top-20 z-[70] rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl ${
            toast.ok
              ? "border-emerald-600/50 bg-emerald-950/85 text-emerald-200"
              : "border-rose-600/50 bg-rose-950/85 text-rose-200"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold">✏️ แก้ไขเนื้อหา</h1>
            {data && (
              <p className="mt-1 text-sm text-slate-400">
                สถานะ {data.status}
                {data.status === "PUBLISHED" &&
                  " · การแก้ไขจะเปลี่ยนเป็น Ready และต้อง Publish ใหม่"}
              </p>
            )}
          </div>
          <Link
            href={`/courses/${courseId}/preview`}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500"
          >
            ▶ ดูตัวอย่างเกม
          </Link>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-6 text-rose-300">{error}</div>
        ) : !data ? (
          <div className="h-64 animate-pulse rounded-2xl bg-slate-900/50" />
        ) : (
          <>
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              <h2 className="mb-4 font-bold text-slate-200">ข้อมูลคอร์ส</h2>
              <div className="space-y-3">
                <input
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="ชื่อคอร์ส"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <textarea
                  value={courseDescription}
                  onChange={(e) => setCourseDescription(e.target.value)}
                  placeholder="คำอธิบาย"
                  rows={3}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSaveCourse}
                  disabled={busy || !courseTitle.trim()}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  บันทึกข้อมูลคอร์ส
                </button>
              </div>
            </section>

            <div className="mt-8 space-y-4">
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

            <section className="mt-8 flex flex-wrap gap-2 rounded-2xl border border-dashed border-slate-700 p-5">
              <input
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                placeholder="ชื่อ Chapter ใหม่"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <button
                onClick={handleAddChapter}
                disabled={busy || !newChapterTitle.trim()}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                + เพิ่ม Chapter
              </button>
            </section>
          </>
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
    <details className="rounded-2xl border border-slate-800 bg-slate-900/50" open={index === 0}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4">
        <span className="text-xs font-bold text-indigo-400">#{index + 1}</span>
        <span className="flex-1 truncate font-semibold text-slate-200">{chapter.title}</span>
        <span className="text-xs text-slate-500">{chapter.quiz_questions.length} คำถาม</span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onMove(chapter, -1)}
            disabled={index === 0}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(chapter, 1)}
            disabled={index === total - 1}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onDelete(chapter)}
            className="rounded border border-rose-900/60 px-2 py-1 text-xs text-rose-400 hover:bg-rose-950/40"
          >
            ลบ
          </button>
        </span>
      </summary>

      <div className="space-y-4 border-t border-slate-800 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ชื่อ Chapter"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <input
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            placeholder="ชื่อบทเรียน"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="จุดประสงค์การเรียนรู้"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="เนื้อหาบทเรียน"
          rows={6}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed outline-none focus:border-indigo-500"
        />
        <button
          onClick={saveChapter}
          disabled={saving || !title.trim()}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : "บันทึก Chapter"}
        </button>

        <div className="space-y-3 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-300">คำถาม ({chapter.quiz_questions.length})</h3>
            <button
              onClick={() => {
                setAdding((v) => !v);
                setEditingId(null);
              }}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              {adding ? "ปิดฟอร์ม" : "+ เพิ่มคำถาม"}
            </button>
          </div>

          {chapter.quiz_questions.map((question) => (
            <div key={question.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-indigo-400">
                    {TYPE_LABEL[question.question_type]} · {question.difficulty} · {question.points} XP
                  </p>
                  <p className="mt-1 text-sm text-slate-200">{question.question}</p>
                  {question.question_type === "multiple_choice" || question.question_type === "true_false" ? (
                    <p className="mt-1 text-xs text-emerald-400">
                      เฉลย: {question.options[question.correct_answer_index]}
                    </p>
                  ) : question.question_type === "matching" ? (
                    <p className="mt-1 text-xs text-emerald-400">
                      เฉลย:{" "}
                      {(question.matching_pairs ?? [])
                        .map((pair) => `${pair.left} → ${pair.right}`)
                        .join(", ")}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-400">
                      เฉลย: {(question.ordering_items ?? []).join(" → ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => {
                      setEditingId(editingId === question.id ? null : question.id);
                      setAdding(false);
                    }}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
                  >
                    {editingId === question.id ? "ปิด" : "แก้ไข"}
                  </button>
                  <button
                    onClick={() => removeQuestion(question)}
                    className="rounded border border-rose-900/60 px-2 py-1 text-xs text-rose-400 hover:bg-rose-950/40"
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
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-xl border border-indigo-900/40 bg-indigo-950/10 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as QuestionType)}
          className={inputClass}
        >
          {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={inputClass}>
          <option value="easy">ง่าย</option>
          <option value="medium">ปานกลาง</option>
          <option value="hard">ยาก</option>
        </select>
        <input
          type="number"
          min={1}
          max={1000}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className={inputClass}
          placeholder="คะแนน"
        />
      </div>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="คำถาม"
        rows={2}
        className={inputClass}
      />

      {type === "matching" ? (
        <div className="space-y-2">
          {pairs.map((pair, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={pair.left}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, idx) => (idx === i ? { ...p, left: e.target.value } : p))
                  )
                }
                placeholder={`ซ้าย ${i + 1}`}
                className={inputClass}
              />
              <input
                value={pair.right}
                onChange={(e) =>
                  setPairs((prev) =>
                    prev.map((p, idx) => (idx === i ? { ...p, right: e.target.value } : p))
                  )
                }
                placeholder={`ขวา ${i + 1}`}
                className={inputClass}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPairs((prev) => [...prev, { left: "", right: "" }])}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + เพิ่มคู่
          </button>
        </div>
      ) : type === "ordering" ? (
        <div className="space-y-2">
          {items.map((item, i) => (
            <input
              key={i}
              value={item}
              onChange={(e) =>
                setItems((prev) => prev.map((it, idx) => (idx === i ? e.target.value : it)))
              }
              placeholder={`ลำดับที่ ${i + 1} (เรียงจากถูกต้อง)`}
              className={inputClass}
            />
          ))}
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, ""])}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + เพิ่มรายการ
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {(type === "true_false" ? options.slice(0, 2) : options).map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${initial?.id ?? "new"}`}
                checked={correctIndex === i}
                onChange={() => setCorrectIndex(i)}
                className="accent-emerald-500"
              />
              <input
                value={option}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={type === "true_false" ? (i === 0 ? "จริง" : "เท็จ") : `ตัวเลือก ${i + 1}`}
                className={inputClass}
              />
            </div>
          ))}
          {type === "multiple_choice" && (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              + เพิ่มตัวเลือก
            </button>
          )}
        </div>
      )}

      <textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        placeholder="คำอธิบายเฉลย (ไม่บังคับ)"
        rows={2}
        className={inputClass}
      />

      {formError && <p className="text-xs text-rose-400">{formError}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
