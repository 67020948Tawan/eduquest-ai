"use client";

// ==============================================================================
// Landing Page — Professional Gamified SaaS
// Hero game-window preview (live pixel scene) · scroll reveal · particles
// ==============================================================================

import { useEffect, useRef } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { PixelScene, PixelSprite } from "@/components/PixelArt";

/* ---- Scroll reveal hook ---- */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".eq-reveal"));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return ref;
}

/* ---- Background dust motes (deterministic positions) ---- */
const MOTES = [
  { l: "8%", s: 3, d: 26, delay: 0 },
  { l: "22%", s: 2, d: 34, delay: 6 },
  { l: "41%", s: 4, d: 30, delay: 12 },
  { l: "58%", s: 2, d: 24, delay: 3 },
  { l: "73%", s: 3, d: 38, delay: 9 },
  { l: "88%", s: 2, d: 28, delay: 15 },
];

export default function Home() {
  const revealRef = useReveal();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />

      <main ref={revealRef} className="relative flex flex-1 flex-col overflow-hidden">
        {/* Ambient blobs + motes */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="eq-blob absolute -left-32 top-10 h-80 w-80 rounded-full bg-indigo-600/40" />
          <div className="eq-blob eq-blob-delay absolute right-0 top-40 h-96 w-96 rounded-full bg-fuchsia-600/30" />
          <div className="eq-blob absolute left-1/3 top-[60vh] h-72 w-72 rounded-full bg-cyan-500/25" />
          {MOTES.map((m, i) => (
            <span
              key={i}
              className="eq-mote bottom-0"
              style={{
                left: m.l,
                width: m.s,
                height: m.s,
                animationDuration: `${m.d}s`,
                animationDelay: `${m.delay}s`,
                ["--po" as string]: 0.55,
                ["--px" as string]: `${i % 2 === 0 ? 24 : -18}px`,
              }}
            />
          ))}
        </div>

        {/* ================= HERO ================= */}
        <section className="relative px-6 pb-20 pt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
            {/* Copy */}
            <div>
              <p className="eq-reveal inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-950/50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-indigo-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                AI Game Studio for Learning
              </p>

              <h1 className="eq-reveal mt-5 text-4xl font-black leading-[1.15] sm:text-5xl lg:text-[3.4rem]">
                เปลี่ยนบทเรียนของคุณ
                <br />
                เป็น{" "}
                <span className="eq-gradient-text">เกมที่เล่นได้จริง</span>
              </h1>

              <p className="eq-reveal mt-5 max-w-lg text-lg leading-relaxed text-slate-400">
                ใส่ไฟล์ PDF หนึ่งไฟล์ — AI อ่าน เข้าใจ แล้วสร้างโลก ตัวละคร
                ศัตรู บอส และคำถามจากเนื้อหาจริง พร้อมระบบ XP · Combat ·
                Base Building ที่นักเรียนเล่นได้ทันทีจากลิงก์เดียว
              </p>

              <div className="eq-reveal mt-9 flex flex-wrap items-center gap-4">
                <Link
                  href="/login"
                  className="eq-glow rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-8 py-4 text-lg font-black tracking-wide transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  🚀 เริ่มสร้างเกมฟรี
                </Link>
                <Link
                  href="/login?demo=1"
                  className="rounded-2xl border border-slate-700 px-7 py-4 text-base font-semibold text-slate-300 transition hover:border-indigo-500/60 hover:bg-slate-900 hover:text-white"
                >
                  🎮 ลอง Demo ทันที
                </Link>
                <Link
                  href="/join"
                  className="rounded-2xl border border-amber-700/60 px-7 py-4 text-base font-semibold text-amber-300 transition hover:border-amber-500 hover:bg-amber-950/30 hover:text-amber-200"
                >
                  🎟️ มีรหัสเข้าห้อง?
                </Link>
              </div>

              <div className="eq-reveal mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
                <span>📄 PDF / DOCX / PPTX + OCR สแกน</span>
                <span>🧠 DeepSeek AI</span>
                <span>📱 เล่นได้ทุกอุปกรณ์</span>
              </div>
            </div>

            {/* Game window mock */}
            <div className="eq-reveal relative">
              <div
                className="absolute -inset-4 rounded-[2rem] opacity-60 blur-2xl"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(99,102,241,.35), rgba(217,70,239,.25), rgba(34,211,238,.3))",
                }}
              />
              <div className="relative overflow-hidden rounded-3xl border border-slate-700/80 shadow-2xl shadow-indigo-950/60">
                {/* window bar */}
                <div className="flex items-center gap-1.5 border-b border-slate-800 bg-slate-900/90 px-4 py-2.5 backdrop-blur">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                  <span className="ml-3 font-mono text-[11px] text-slate-500">
                    eduquest://database-kingdom — LIVE
                  </span>
                </div>

                <div className="relative">
                  <PixelScene environment="village" seed="landing-hero" animated width={undefined as unknown as number} />
                  {/* HUD chips */}
                  <div className="absolute left-3 top-3 flex gap-2">
                    <span className="rounded-full border border-rose-500/40 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-rose-300 backdrop-blur-sm">
                      ❤️ 88/100
                    </span>
                    <span className="rounded-full border border-amber-500/40 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-amber-300 backdrop-blur-sm">
                      🔥 XP 1,240
                    </span>
                  </div>

                  {/* Hero sprite */}
                  <div className="absolute bottom-6 left-[16%] drop-shadow-[0_6px_16px_rgba(0,0,0,0.6)]">
                    <PixelSprite kind="hero" seed="landing-hero" size={84} floating />
                  </div>

                  {/* Enemy sprite */}
                  <div className="absolute bottom-8 right-[14%] drop-shadow-[0_6px_16px_rgba(0,0,0,0.6)]">
                    <PixelSprite kind="enemy" seed="landing-slime" size={64} floating />
                  </div>

                  {/* damage floaty */}
                  <span className="eq-float eq-dmg absolute right-[26%] top-[30%] text-xl text-amber-300">
                    -44!
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
                  <span className="text-[11px] font-semibold text-slate-400">
                    ⚔️ Turn-Based Combat · 🏰 Base Building
                  </span>
                  <span className="text-[11px] font-bold text-emerald-400">● RUNNING</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= PIPELINE ================= */}
        <section className="relative border-y border-slate-800/60 bg-slate-900/30 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="eq-reveal text-center text-2xl font-bold sm:text-3xl">
              จาก<span className="text-indigo-400">ไฟล์เรียน</span> →{" "}
              <span className="text-emerald-400">เกม</span> ใน 4 ขั้นตอน
            </h2>
            <p className="eq-reveal mx-auto mt-3 max-w-md text-center text-sm text-slate-400">
              ไม่ต้องเขียนโค้ด ไม่ต้องออกแบบกราฟฟิก — AI จัดการทุกอย่าง
            </p>

            <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { n: "01", t: "UPLOAD", d: "ใส่ไฟล์บทเรียน", icon: "📄" },
                { n: "02", t: "CHOOSE", d: "เลือกโหมดเกม", icon: "🎮" },
                { n: "03", t: "GENERATE", d: "AI สร้างโลกทั้งเกม", icon: "✨" },
                { n: "04", t: "SHARE", d: "ส่งลิงก์ให้เรียน", icon: "🔗" },
              ].map((s, i) => (
                <div key={s.n} className="eq-reveal relative" style={{ transitionDelay: `${i * 120}ms` }}>
                  <div className="group h-full rounded-2xl border border-slate-800 bg-slate-950/80 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/60 hover:shadow-xl hover:shadow-indigo-950/40">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-indigo-500">{s.n}</span>
                      <span className="text-2xl transition-transform duration-300 group-hover:scale-125 group-hover:-rotate-6">
                        {s.icon}
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-sm font-black tracking-wider">{s.t}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.d}</p>
                  </div>
                  {/* connector */}
                  {i < 3 && (
                    <span className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-gradient-to-r from-indigo-600/60 to-transparent md:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= FEATURES ================= */}
        <section className="px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <h2 className="eq-reveal text-center text-2xl font-bold sm:text-3xl">
              ไม่ใช่ Quiz Generator ธรรมดา
            </h2>
            <p className="eq-reveal mx-auto mt-3 max-w-lg text-center text-sm text-slate-400">
              ระบบเกมครบวงจรที่ออกแบบมาเพื่อการเรียนรู้โดยเฉพาะ
            </p>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: "⚔️", t: "Turn-Based Combat", d: "HP · ดาเมจ · Combo Crit · Boss Phase — ตอบถูกคือโจมตี ตอบผิดโดนสวนกลับ", glow: "hover:border-rose-500/60 hover:shadow-rose-950/40" },
                { icon: "🏰", t: "Base Building", d: "สร้างฐาน 7 อาคาร ผลิตทรัพยากรตามเวลาจริง · Raid event ขับไล่ด้วยความรู้", glow: "hover:border-emerald-500/60 hover:shadow-emerald-950/40" },
                { icon: "📜", t: "RPG World", d: "โซนผูกกับ Chapter · NPC สนทนา · Enemy/Boss จาก Concept จริงในบทเรียน", glow: "hover:border-violet-500/60 hover:shadow-violet-950/40" },
                { icon: "📊", t: "Learning Analytics", d: "Coverage/Mastery ราย chapter · Weak topics + คำแนะนำอัตโนมัติหลังจบเกม", glow: "hover:border-cyan-500/60 hover:shadow-cyan-950/40" },
                { icon: "🔗", t: "One-Link Share", d: "Publish → ได้ URL + QR — นักเรียนเปิดเล่นได้ทันที Guest mode ไม่ต้องสมัคร", glow: "hover:border-amber-500/60 hover:shadow-amber-950/40" },
                { icon: "🛡️", t: "Server-Side Trust", d: "XP และคำตอบตรวจที่ backend 100% · anti-cheat · save progress ต่ออุปกรณ์", glow: "hover:border-sky-500/60 hover:shadow-sky-950/40" },
              ].map((f, i) => (
                <div
                  key={f.t}
                  className={`eq-reveal group rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all duration-300 hover:-translate-y-1.5 hover:bg-slate-900 ${f.glow}`}
                  style={{ transitionDelay: `${(i % 3) * 90}ms` }}
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl border border-slate-700 bg-slate-950 text-2xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                    {f.icon}
                  </div>
                  <h3 className="mt-4 font-bold">{f.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= CTA ================= */}
        <section className="relative overflow-hidden border-t border-slate-800/60 px-6 py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(99,102,241,0.18),transparent_65%)]" />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="eq-reveal text-3xl font-black sm:text-4xl">
              พร้อมให้ห้องเรียนของคุณ
              <span className="eq-gradient-text"> เป็นเกมแล้วหรือยัง?</span>
            </h2>
            <p className="eq-reveal mx-auto mt-4 max-w-md text-slate-400">
              สร้างเกมแรกใช้เวลาไม่ถึง 5 นาที — ส่งลิงก์ให้นักเรียนเล่นได้เลย
            </p>
            <div className="eq-reveal mt-8">
              <Link
                href="/login"
                className="eq-glow inline-block rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-10 py-4 text-lg font-black tracking-wide transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                เริ่มใช้งานวันนี้ →
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-800/60 px-6 py-8 text-center text-sm text-slate-500">
          EduQuest AI — Turn Learning Materials into Playable Games
        </footer>
      </main>
    </div>
  );
}
