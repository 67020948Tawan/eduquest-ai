"use client";

// ==============================================================================
// Create Game — ขั้นตอนสร้างคอร์ส (อัปเกรดเฟส 1)
// ขั้น 1: อัปโหลดไฟล์ → ขั้น 2: ตั้งค่าเกม (ความยาว + ประเภทคำถาม) → ตรวจสอบเนื้อหา → สร้าง
// ==============================================================================

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken, useHydrated } from "@/lib/useAuthToken";
import {
  createCourse,
  deleteCourse,
  uploadDocument,
  generateGame,
  analyzeContentSufficiency,
  type VisualStyle,
  type GameLength,
  type QuestionType,
  type ContentSufficiency,
} from "@/lib/api";

const GAME_MODES = [
  { id: "standard_quiz", title: "🧠 Standard Quiz", desc: "แบบทดสอบวัดความเข้าใจ" },
  { id: "rpg_lore", title: "📜 RPG Adventure", desc: "โลกผจญภัย + NPC + เควสต์" },
  { id: "turn_based", title: "⚔️ Turn-Based Combat", desc: "ตอบถูก = โจมตี ตอบผิด = โดนตี" },
  { id: "base_building", title: "🏰 Base Building", desc: "สร้างฐาน สะสมทรัพยากร" },
];

const LENGTH_OPTIONS: { id: GameLength; title: string; desc: string; chapters: number; qpc: number }[] = [
  { id: "short", title: "📖 สั้น", desc: "5 บท × 2 ข้อ = รวม 10 ข้อ", chapters: 5, qpc: 2 },
  { id: "medium", title: "⚖️ กลาง", desc: "10 บท × 3 ข้อ = รวม 30 ข้อ", chapters: 10, qpc: 3 },
  { id: "long", title: "📚 ยาว", desc: "15 บท × 4 ข้อ = รวม 60 ข้อ", chapters: 15, qpc: 4 },
];

const QUESTION_TYPE_OPTIONS: { id: QuestionType; title: string; desc: string }[] = [
  { id: "multiple_choice", title: "🔘 เลือกข้อ", desc: "เลือกคำตอบถูกจากตัวเลือก" },
  { id: "true_false", title: "✅❌ จริง/เท็จ", desc: "ตอบว่าข้อความจริงหรือเท็จ" },
  { id: "matching", title: "🔗 จับคู่", desc: "จับคู่คำศัพท์กับความหมาย" },
  { id: "ordering", title: "🔢 เรียงลำดับ", desc: "เรียงขั้นตอนให้ถูกต้อง" },
];

export default function CreateCoursePage() {
  const router = useRouter();
  const token = useAuthToken();
  const hydrated = useHydrated();

  const [file, setFile] = useState<File | null>(null);
  const [modes, setModes] = useState<string[]>(["rpg_lore"]);
  const [gameLength, setGameLength] = useState<GameLength>("medium");
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([
    "multiple_choice",
    "true_false",
    "matching",
    "ordering",
  ]);
  const [questionsPerChapter, setQuestionsPerChapter] = useState(3);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sufficiency, setSufficiency] = useState<ContentSufficiency | null>(null);
  const [sufficiencyLoading, setSufficiencyLoading] = useState(false);
  // คอร์ส draft ที่สร้างตอนกดตรวจเนื้อหา — ใช้ต่อตอนกดสร้างเกม (กันสร้างซ้ำ)
  const [draftCourseId, setDraftCourseId] = useState<number | null>(null);

  // ล้าง draft เก่าเมื่อเปลี่ยนไฟล์/ความยาว/โหมด (ผลตรวจเนื้อหาเดิมใช้ไม่ได้แล้ว)
  function discardDraft() {
    setSufficiency(null);
    if (draftCourseId) {
      deleteCourse(draftCourseId).catch(() => {});
      setDraftCourseId(null);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    if (!token) router.replace("/login");
  }, [hydrated, token, router]);

  const titleFromFileName = useMemo(
    () => (file ? file.name.replace(/\.[^.]+$/, "") : ""),
    [file]
  );

  const lengthCfg = useMemo(
    () => LENGTH_OPTIONS.find((l) => l.id === gameLength)!,
    [gameLength]
  );

  function toggleMode(id: string) {
    if (draftCourseId) discardDraft();
    setModes((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  function toggleQuestionType(id: QuestionType) {
    setQuestionTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleCheckContent() {
    if (!file) return setError("กรุณาใส่ไฟล์บทเรียนก่อน");
    if (modes.length === 0) return setError("กรุณาเลือกหมวดเกมอย่างน้อย 1 หมวด");
    if (questionTypes.length === 0) return setError("กรุณาเลือกประเภทคำถามอย่างน้อย 1 ประเภท");

    try {
      setError(null);
      setSufficiencyLoading(true);
      setSufficiency(null);
      setStep(1);

      // ถ้ามี draft เก่าจากการกดตรวจรอบก่อน ให้ลบทิ้งก่อน (กันคอร์สซ้ำ)
      if (draftCourseId) {
        try {
          await deleteCourse(draftCourseId);
        } catch {
          /* ignore */
        }
        setDraftCourseId(null);
      }

      // Step 1: create course (draft) first so we have course_id
      const course = await createCourse({
        title: titleFromFileName || "My Learning Game",
        description: "",
        subject: "",
        difficulty: "beginner",
        gameModes: modes,
        visualStyle: "pixel_art" as VisualStyle,
        gameLength,
        questionTypes,
        questionsPerChapter,
      });
      setDraftCourseId(course.id);

      // Step 2: upload document
      await uploadDocument(course.id, file);

      // Step 3: ask AI to check content sufficiency
      const suff = await analyzeContentSufficiency(course.id, gameLength);
      setSufficiency(suff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตรวจสอบเนื้อหาไม่สำเร็จ");
      setStep(0);
    } finally {
      setSufficiencyLoading(false);
    }
  }

  async function handleGenerate() {
    if (!file) return setError("กรุณาใส่ไฟล์บทเรียนก่อน");
    if (!sufficiency) return setError("กรุณาตรวจสอบเนื้อหาก่อนสร้างเกม");

    try {
      setStep(2);
      setBusy(true);
      setError(null);

      // ใช้คอร์ส draft ที่สร้างตอนตรวจเนื้อหา (ถ้ายังมี) — ไม่สร้างซ้ำ
      let courseId = draftCourseId;
      if (!courseId) {
        const course = await createCourse({
          title: titleFromFileName || "My Learning Game",
          description: "",
          subject: "",
          difficulty: "beginner",
          gameModes: modes,
          visualStyle: "pixel_art" as VisualStyle,
          gameLength,
          questionTypes,
          questionsPerChapter,
        });
        courseId = course.id;
        setDraftCourseId(course.id);
        await uploadDocument(course.id, file);
      }

      await generateGame(courseId, {
        gameLength,
        questionTypes,
      });

      setDraftCourseId(null);
      router.push(`/courses/${courseId}/preview`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างเกมไม่สำเร็จ");
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  const totalQuestions = lengthCfg.chapters * lengthCfg.qpc;

  if (!hydrated || token === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">
        กำลังตรวจสอบการเข้าสู่ระบบ...
      </div>
    );
  }

  const canGenerate = Boolean(sufficiency?.sufficient) || (sufficiency?.level === "borderline");

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-bold">🎮 สร้างเกมจากไฟล์บทเรียน</h1>
        <p className="mt-2 text-slate-400">อัปโหลด → ตั้งค่าเกม → ตรวจสอบเนื้อหา → สร้างด้วย AI</p>

        <form onSubmit={(e) => e.preventDefault()} className="mt-8 space-y-6 pb-16">
          {/* STEP 1 — File */}
          <section
            className={`rounded-2xl border-2 p-6 transition-all ${
              file ? "border-emerald-500/70 bg-emerald-950/15" : "border-slate-700 bg-slate-900/60"
            }`}
          >
            <h2 className="font-bold">
              <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-indigo-500 text-sm text-white">1</span>
              ใส่ไฟล์บทเรียน
            </h2>
            <input
              required
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md"
              disabled={busy}
              onChange={(e) => {
                if (draftCourseId) discardDraft();
                setFile(e.target.files?.[0] || null);
              }}
              className="mt-4 w-full cursor-pointer rounded-xl border border-dashed border-slate-600 bg-slate-950 px-4 py-8 text-center text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-5 file:py-2.5 file:font-semibold file:text-white hover:border-indigo-500/60 hover:file:bg-indigo-500"
            />
            <p className="mt-2 text-xs text-slate-500">รองรับ PDF / DOCX / PPTX / TXT (รวม PDF ภาพสแกน)</p>
            {file && (
              <p className="eq-pop mt-3 text-sm font-semibold text-emerald-400">
                ✓ {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </section>

          {/* STEP 2 — Game Settings */}
          <section className="rounded-2xl border-2 border-slate-700 bg-slate-900/60 p-6">
            <h2 className="font-bold mb-4">
              <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-indigo-500 text-sm text-white">2</span>
              ตั้งค่าเกม
            </h2>

            <div className="space-y-4">
              {/* Game Modes */}
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
                <h3 className="font-semibold text-slate-200 mb-3">
                  🕹️ หมวดเกม <span className="text-xs font-normal text-slate-500">(เลือกได้หลายหมวด)</span>
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GAME_MODES.map((m) => {
                    const on = modes.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMode(m.id)}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          on
                            ? "border-emerald-500 bg-emerald-950/25 shadow-md shadow-emerald-950/30"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{m.title}</span>
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] ${
                              on ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600"
                            }`}
                          >
                            {on ? "✓" : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{m.desc}</p>
                      </button>
                    );
                  })}
                </div>
                {modes.length === 0 && (
                  <p className="mt-2 text-xs text-rose-400">⚠️ เลือกอย่างน้อย 1 หมวดเกม</p>
                )}
              </div>

              {/* Game Length */}
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
                <h3 className="font-semibold text-slate-200 mb-3">⏱️ ความยาวเกม</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  {LENGTH_OPTIONS.map((l) => {
                    const active = gameLength === l.id;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          if (l.id !== gameLength && draftCourseId) discardDraft();
                          setGameLength(l.id);
                        }}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          active
                            ? "border-emerald-500 bg-emerald-950/30 shadow-md shadow-emerald-950/30"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{l.title}</span>
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] ${
                              active ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600"
                            }`}
                          >
                            {active ? "✓" : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{l.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Question Types */}
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
                <h3 className="font-semibold text-slate-200 mb-3">🎯 ประเภทคำถาม (เลือกได้หลาย)</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {QUESTION_TYPE_OPTIONS.map((qt) => {
                    const on = questionTypes.includes(qt.id);
                    return (
                      <button
                        key={qt.id}
                        type="button"
                        onClick={() => toggleQuestionType(qt.id)}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          on
                            ? "border-emerald-500 bg-emerald-950/25 shadow-md shadow-emerald-950/30"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{qt.title}</span>
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] ${
                              on ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600"
                            }`}
                          >
                            {on ? "✓" : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{qt.desc}</p>
                      </button>
                    );
                  })}
                </div>
                {questionTypes.length === 0 && (
                  <p className="mt-2 text-xs text-rose-400">⚠️ เลือกอย่างน้อย 1 ประเภท (ระบบจะบังคับมี multiple_choice เสมอ)</p>
                )}
              </div>

              {/* Estimated questions */}
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3 text-sm">
                <p className="font-semibold text-indigo-300">📊 คาดการณ์: {lengthCfg.chapters} บท × {totalQuestions / lengthCfg.chapters} ข้อ/บท = {totalQuestions} คำถามรวม</p>
              </div>
            </div>
          </section>

          {/* STEP 3 — Content Sufficiency Check (AI) */}
          {file && (
            <section className="rounded-2xl border-2 border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-bold mb-4">
                <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-indigo-500 text-sm text-white">3</span>
                ตรวจสอบเนื้อหาโดย AI
              </h2>
              <p className="text-sm text-slate-400 mb-3">AI จะอ่านเอกสารแล้วบอกว่าเนื้อหาพอต่อความยาวที่เลือกหรือไม่</p>

              {sufficiencyLoading ? (
                <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/30 p-5 text-sm">
                  <p className="mb-2 font-bold text-indigo-300">🤖 AI กำลังอ่านและวิเคราะห์เนื้อหา...</p>
                </div>
              ) : sufficiency ? (
                <div className={`rounded-xl p-4 ${
                  sufficiency.level === "sufficient"
                    ? "border-emerald-500/50 bg-emerald-950/20"
                    : sufficiency.level === "borderline"
                      ? "border-amber-500/50 bg-amber-950/20"
                      : "border-rose-500/50 bg-rose-950/20"
                }`}>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 text-2xl">
                      {sufficiency.level === "sufficient" ? "✅" : sufficiency.level === "borderline" ? "⚠️" : "❌"}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-200">
                        {sufficiency.level === "sufficient" ? "เนื้อหาเพียงพอ" : sufficiency.level === "borderline" ? "เนื้อหาพอใช้" : "เนื้อหาน้อยเกินไป"}
                      </h3>
                      <p className="text-sm text-slate-400 mt-1">
                        AI ประเมินว่าสร้างคำถามได้สูงสุดประมาณ {sufficiency.estimated_questions} ข้อ
                        แนะนำความยาว: {sufficiency.recommended_length === "short" ? "สั้น" : sufficiency.recommended_length === "medium" ? "กลาง" : "ยาว"}
                      </p>
                      {sufficiency.warnings.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-amber-400 mb-1">⚠️ คำเตือน:</p>
                          <ul className="text-xs text-amber-200/90 list-disc list-inside space-y-1">
                            {sufficiency.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      )}
                      {sufficiency.suggestions.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-emerald-400 mb-1">💡 คำแนะนำ:</p>
                          <ul className="text-xs text-emerald-200/90 list-disc list-inside space-y-1">
                            {sufficiency.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleCheckContent}
                  disabled={busy || sufficiencyLoading}
                  className="w-full rounded-xl border border-indigo-600 bg-indigo-950/40 px-4 py-3 text-sm font-bold text-indigo-300 transition hover:bg-indigo-600/60 disabled:opacity-50"
                >
                  {sufficiencyLoading ? "🤖 กำลังตรวจสอบ..." : "🔍 ให้ AI ตรวจสอบเนื้อหา"}
                </button>
              )}
            </section>
          )}

          {error && (
            <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-4 text-sm text-rose-300">
              ⚠️ {error}
            </div>
          )}

          {/* Progress */}
          {busy && (
            <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/30 p-5 text-sm">
              <p className="mb-2 font-bold text-indigo-300">✨ AI กำลังสร้างเกม...</p>
              <div className="space-y-1.5 text-slate-300">
                <p>📄 อ่านบทเรียน (OCR ถ้าเป็นไฟล์สแกน)</p>
                <p className="animate-pulse">🌍 ออกแบบโลก ตัวละคร ศัตรู บอส...</p>
                <p className="animate-pulse">❓ สร้างคำถามหลายประเภทจากเนื้อหาจริง...</p>
              </div>
              <p className="mt-2 text-xs text-slate-500">ใช้เวลาประมาณ 15-90 วินาที กรุณารอสักครู่</p>
            </div>
          )}

          {!error && !busy && step < 2 && sufficiency && canGenerate && (
            <button
              onClick={handleGenerate}
              className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 py-4 text-xl font-black tracking-wide shadow-xl shadow-violet-950/40 transition-all hover:scale-[1.01]"
            >
              ✨ สร้างเกมด้วย AI เลย!
            </button>
          )}
          {!error && !busy && step < 2 && sufficiency && !canGenerate && (
            <button
              disabled
              className="w-full rounded-2xl bg-slate-800 py-4 text-xl font-black tracking-wide text-slate-500 cursor-not-allowed"
            >
              ❌ ปรับความยาวหรือเพิ่มเนื้อหาก่อน แล้วค่อยสร้าง
            </button>
          )}
        </form>
      </main>
    </div>
  );
}
