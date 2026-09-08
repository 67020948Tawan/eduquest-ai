"use client";

// ==============================================================================
// Create Game — Simple Mode
// ขั้น 1: อัปโหลดไฟล์ → ขั้น 2: เลือกโหมดเกม → กดสร้างจบ
// (ชื่อเกมดึงจากไฟล์อัตโนมัติ · visual style default Pixel Art)
// ==============================================================================

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { useAuthToken } from "@/lib/useAuthToken";
import {
  createCourse,
  uploadDocument,
  generateGame,
  type VisualStyle,
} from "@/lib/api";

const GAME_MODES = [
  { id: "standard_quiz", title: "🧠 Standard Quiz", desc: "แบบทดสอบวัดความเข้าใจ" },
  { id: "rpg_lore", title: "📜 RPG Adventure", desc: "โลกผจญภัย + NPC + เควสต์" },
  { id: "turn_based", title: "⚔️ Turn-Based Combat", desc: "ตอบถูก = โจมตี ตอบผิด = โดนตี" },
  { id: "base_building", title: "🏰 Base Building", desc: "สร้างฐาน สะสมทรัพยากร" },
];

export default function CreateCoursePage() {
  const router = useRouter();
  const token = useAuthToken();

  const [file, setFile] = useState<File | null>(null);
  const [modes, setModes] = useState<string[]>(["rpg_lore"]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) router.replace("/login");
  }, [token, router]);

  const titleFromFileName = useMemo(
    () => (file ? file.name.replace(/\.[^.]+$/, "") : ""),
    [file]
  );

  function toggleMode(id: string) {
    setModes((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) return setError("กรุณาใส่ไฟล์บทเรียนก่อน");
    if (modes.length === 0) return setError("กรุณาเลือกโหมดเกมอย่างน้อย 1 โหมด");

    try {
      // Step 1 — create course
      setStep(1);
      setBusy(true);
      const course = await createCourse({
        title: titleFromFileName || "My Learning Game",
        description: "",
        subject: "",
        difficulty: "beginner",
        gameModes: modes,
        visualStyle: "pixel_art" as VisualStyle,
      });

      // Step 2 — upload + AI generate
      setStep(2);
      await uploadDocument(course.id, file);
      await generateGame(course.id, {});

      router.push(`/courses/${course.id}/preview`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  if (token === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">
        กำลังตรวจสอบการเข้าสู่ระบบ...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-bold">🎮 สร้างเกมจากไฟล์บทเรียน</h1>
        <p className="mt-2 text-slate-400">ใส่ไฟล์ → เลือกโหมด → กดสร้าง จบ!</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6 pb-16">
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
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-4 w-full cursor-pointer rounded-xl border border-dashed border-slate-600 bg-slate-950 px-4 py-8 text-center text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-5 file:py-2.5 file:font-semibold file:text-white hover:border-indigo-500/60 hover:file:bg-indigo-500"
            />
            <p className="mt-2 text-xs text-slate-500">รองรับ PDF / DOCX / PPTX / TXT (รวม PDF ภาพสแกน)</p>
            {file && (
              <p className="eq-pop mt-3 text-sm font-semibold text-emerald-400">
                ✓ {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </section>

          {/* STEP 2 — Modes */}
          <section className="rounded-2xl border-2 border-slate-700 bg-slate-900/60 p-6">
            <h2 className="font-bold">
              <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-indigo-500 text-sm text-white">2</span>
              เลือกโหมดเกม <span className="text-xs font-normal text-slate-500">(เลือกได้หลายโหมด)</span>
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {GAME_MODES.map((m) => {
                const on = modes.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMode(m.id)}
                    className={`rounded-xl border-2 p-4 text-left transition-all ${
                      on
                        ? "border-emerald-500 bg-emerald-950/25 shadow-md shadow-emerald-950/30"
                        : "border-slate-700 bg-slate-950 hover:border-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{m.title}</span>
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px] ${
                          on ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-600"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>

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
                <p className="animate-pulse">❓ สร้างคำถามจากเนื้อหาจริง...</p>
              </div>
              <p className="mt-2 text-xs text-slate-500">ใช้เวลาประมาณ 15-90 วินาที กรุณารอสักครู่</p>
            </div>
          )}

          {!error && !busy && step === 0 && (
            <button
              type="submit"
              className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 py-4 text-xl font-black tracking-wide shadow-xl shadow-violet-950/40 transition-all hover:scale-[1.01]"
            >
              ✨ สร้างเกมเลย!
            </button>
          )}
        </form>
      </main>
    </div>
  );
}
