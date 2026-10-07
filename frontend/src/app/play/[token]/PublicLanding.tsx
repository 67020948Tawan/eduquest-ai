"use client";

// Public Game Landing — Student เปิดลิงก์ /play/{token}
// ไม่ต้อง login · เห็นปกเกม · PLAY NOW → Game Player (guest mode)

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PixelScene, PixelSprite } from "@/components/PixelArt";
import { getPublicCourse, type CourseStructure } from "@/lib/api";

const MODE_LABELS: Record<string, string> = {
  standard_quiz: "🧠 Quiz",
  rpg_lore: "📜 RPG",
  turn_based: "⚔️ Combat",
  base_building: "🏰 Base Building",
};

export default function PublicLanding() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token || "");

  const [data, setData] = useState<CourseStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    getPublicCourse(token)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "โหลดเกมไม่สำเร็จ");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">
        <div className="text-center">
          <div className="eq-float-idle mx-auto w-fit">
            <PixelSprite kind="hero" seed="player-hero" size={64} />
          </div>
          <p className="mt-4 animate-pulse">🌍 กำลังเตรียมโลก...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-6 text-center text-slate-300">
        <div>
          <p className="text-5xl">🔒</p>
          <h1 className="mt-4 text-xl font-bold">{error ?? "ไม่พบเกมนี้"}</h1>
          <p className="mt-2 text-sm text-slate-500">
            ลิงก์อาจถูกปิดการแชร์ หรือไม่ถูกต้อง
          </p>
        </div>
      </div>
    );
  }

  return (
    <LandingBody
      data={data}
      // fresh=1 → ทุกครั้งที่กด PLAY NOW จากลิงก์/QR = เริ่มรอบใหม่ทันที
      // (ไม่ resume ของคนก่อนหน้าบนเครื่อง/บัญชีเดียวกัน)
      onPlay={() => router.push(`/courses/${data.course_id}/preview?guest=1&fresh=1`)}
    />
  );
}

function LandingBody({
  data,
  onPlay,
}: {
  data: CourseStructure;
  onPlay: () => void;
}) {
  const world = (data.world ?? {}) as CourseStructure["world"];
  const modes = data.game_modes ?? [];
  const zones = Array.isArray(world?.zones) ? world.zones : [];
  const estMinutes = Math.max(10, data.chapters.length * 5);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Cover */}
      <div className="relative border-b border-slate-800/60">
        <PixelScene
          environment={zones[0]?.environment || "village"}
          seed={data.course_title}
          style={world.visual_style}
          animated
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(5,8,20,0.78)_100%)]" />

        <div className="absolute inset-0 flex flex-col items-center justify-end pb-6 text-center">
          <span className="rounded-full border border-white/20 bg-slate-950/60 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-300 backdrop-blur-sm">
            EduQuest AI
          </span>
          <h1 className="mt-3 max-w-xl px-4 text-3xl font-black leading-tight drop-shadow-lg sm:text-4xl">
            {world.world_name || data.course_title}
          </h1>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 px-4">
            {(modes.length > 0 ? modes : ["standard_quiz"]).map((m) => (
              <span
                key={m}
                className="rounded-full bg-slate-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 backdrop-blur-sm"
              >
                {MODE_LABELS[m] ?? m}
              </span>
            ))}
            <span className="rounded-full bg-slate-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 backdrop-blur-sm">
              🎨 {(world.visual_style || "pixel_art").replace("_", " ")}
            </span>
            <span className="rounded-full bg-slate-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 backdrop-blur-sm">
              ⏱ ~{estMinutes} นาที
            </span>
            <span className="rounded-full bg-slate-950/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 backdrop-blur-sm">
              📖 {data.chapters.length} chapters
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 text-center">
        {world.intro_story ? (
          <p className="whitespace-pre-line leading-relaxed text-slate-300">{world.intro_story}</p>
        ) : (
          <p className="leading-relaxed text-slate-300">{data.course_description}</p>
        )}

        {/* Chapters preview */}
        <div className="mt-6 space-y-2 text-left">
          {data.chapters.map((ch, i) => (
            <div
              key={ch.chapter_id}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-sm font-bold text-indigo-300">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{ch.title}</span>
              <span className="shrink-0 text-xs text-slate-500">{ch.quiz_questions.length} ภารกิจ</span>
            </div>
          ))}
        </div>

        {/* PLAY NOW */}
        <button
          onClick={onPlay}
          className="mt-8 w-full rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 py-5 text-2xl font-black tracking-wide text-slate-950 shadow-2xl shadow-emerald-900/40 transition-all hover:scale-[1.02] hover:from-emerald-400 active:scale-[0.99]"
        >
          ▶ PLAY NOW
        </button>

        <p className="mt-4 text-xs text-slate-500">
          เล่นได้ทันทีไม่ต้องติดตั้งแอป · ไม่ต้องสมัคร (แยกกันทุกเครื่อง) ·
          กด PLAY NOW ใหม่ = เริ่มรอบใหม่เสมอ
        </p>
      </main>
    </div>
  );
}
