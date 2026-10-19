"use client";

// ==============================================================================
// PixelFx.tsx — ระบบอนิเมชันและเอฟเฟกต์พิเศษสำหรับ EduQuest
//
// สร้างเอฟเฟกต์เกมด้วยโค้ดล้วนๆ ไม่ต้องพึ่งไฟล์ภาพจากภายนอก:
//   - PixelParticles: ละอองแสง, ควัน, ดาวกระจาย
//   - DamageNumber: ตัวเลขคะแนนลอยขึ้นเมื่อตอบถูก/โจมตี
//   - ScreenShake: กระเพื่อมจอเมื่อโดนโจมตี
//   - Confetti: Coriandor เมื่อผ่านด่านหรืออัปเลเวล
//   - PixelButton: ปุ่มกดมีแสงกระพริบตอน hover
//
// ทั้งหมดวาดบน Canvas + CSS アニメะ รันได้บนเว็บฟรีทันที
// ==============================================================================

import { useEffect, useRef, useCallback } from "react";
import React from "react";

/* -------------------------------------------------------------------------- */
/*  Utility: seeded random                                                    */
/* -------------------------------------------------------------------------- */

export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/*  1) PixelParticles — ละอองอนุภาค (explosion / sparkle / smoke)          */
/* -------------------------------------------------------------------------- */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface PixelParticlesProps {
  /** จำนวนอนุภาค */
  count?: number;
  /** สีหลักของอนุภาค */
  color?: string;
  /** ตำแหน่งกลางเอฟเฟกต์ (px) */
  centerX?: number;
  centerY?: number;
  /** ขนาดพื้นที่กระจาย */
  spread?: number;
  /** เวลาทั้งหมดของเอฟเฟกต์ (ms) */
  duration?: number;
  /** ซ่อนเมื่อครบเวลา */
  autoHide?: boolean;
  /** ฟังก์ชันเรียกเมื่อจบ */
  onEnd?: () => void;
  className?: string;
}

export function PixelParticles({
  count = 24,
  color = "#ffd75e",
  centerX = 0,
  centerY = 0,
  spread = 40,
  duration = 900,
  autoHide = true,
  onEnd,
  className = "",
}: PixelParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const seedRef = useRef(mulberry32(Date.now() & 0xffffffff));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const rng = seedRef.current;
    const cx = centerX || W / 2;
    const cy = centerY || H / 2;

    // รีเซ็ตอนุภาค
    const ps: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = rng() * 2 + 0.5;
      ps.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
        size: 1 + rng() * 2,
      });
    }
    particlesRef.current = ps;
    startRef.current = performance.now();

    let last = 0;
    const ctxNonNull = ctx!;
    function loop(ts: number) {
      if (!startRef.current) return;
      rafRef.current = requestAnimationFrame(loop);
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / duration);

      ctxNonNull.clearRect(0, 0, W, H);

      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.life -= 1 / duration * 60; // approximate per-frame
        if (p.life <= 0) p.life = 0;

        const alpha = p.life;
        ctxNonNull.globalAlpha = alpha;
        ctxNonNull.fillStyle = p.color;
        ctxNonNull.fillRect(
          Math.round(p.x),
          Math.round(p.y),
          Math.max(0.5, p.size),
          Math.max(0.5, p.size)
        );
        ctxNonNull.globalAlpha = 1;
      }

      if (progress >= 1) {
        cancelAnimationFrame(rafRef.current);
        onEnd?.();
      }
      last = ts;
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [count, color, centerX, centerY, spread, duration, autoHide, onEnd]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "block",
      }}
      aria-hidden="true"
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  2) DamageNumber — ตัวเลขลอยขึ้นเมื่อโจมตีหรือตอบคำถาม                 */
/* -------------------------------------------------------------------------- */

interface DamageNumberProps {
  value: number | string;
  x: number;
  y: number;
  color?: string;
  scale?: number;
  duration?: number;
  onEnd?: () => void;
}

export function DamageNumber({
  value,
  x,
  y,
  color = "#ffd75e",
  scale = 1.2,
  duration = 800,
  onEnd,
}: DamageNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const elNonNull = el;
    start.current = performance.now();

    let id: number;
    function tick(ts: number) {
      id = requestAnimationFrame(tick);
      const elapsed = ts - start.current;
      const p = Math.min(1, elapsed / duration);

      // ยางยืดขึ้นและจาง
      elNonNull.style.transform = `translateY(${-p * 40}px) scale(${1 + (1 - p) * 0.4})`;
      elNonNull.style.opacity = String(1 - p);

      if (p >= 1) {
        cancelAnimationFrame(id);
        onEnd?.();
      }
    }
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value, x, y, color, scale, duration, onEnd]);

  return (
    <span
      ref={ref}
      className="pointer-events-none select-none"
      style={{
        position: "absolute",
        left: x,
        top: y,
        color,
        fontWeight: "900",
        fontSize: `${14 * scale}px`,
        textShadow: "0 2px 4px rgba(0,0,0,0.8)",
        zIndex: 50,
        whiteSpace: "pre",
      }}
    >
      {value}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  3) ScreenShake — คอมโพเนนต์ห่อให้สั่นเมื่อมีการกระแทก                */
/* -------------------------------------------------------------------------- */

interface ScreenShakeProps {
  children: React.ReactNode;
  active: boolean;
  intensity?: number;
  duration?: number;
}

export function ScreenShake({
  children,
  active,
  intensity = 8,
  duration = 500,
}: ScreenShakeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      const el = ref.current;
      if (el) el.style.transform = "none";
      return;
    }
    const el = ref.current;
    if (!el) return;
    const elNonNull = el;
    start.current = performance.now();

    function tick(ts: number) {
      const elapsed = ts - start.current;
      const p = Math.min(1, elapsed / duration);
      if (p >= 1) {
        elNonNull.style.transform = "none";
        cancelAnimationFrame(raf.current);
        return;
      }
      const rng = mulberry32(Math.floor(elapsed));
      const dx = (rng() - 0.5) * intensity * (1 - p);
      const dy = (rng() - 0.5) * intensity * (1 - p);
      elNonNull.style.transform = `translate(${dx}px, ${dy}px)`;
      raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, intensity, duration]);

  return (
    <div ref={ref} className="relative">
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  4) Confetti — Coriandor เมื่อชนะ/อัปเลเวล                              */
/* -------------------------------------------------------------------------- */

interface ConfettiProps {
  count?: number;
  colors?: string[];
  duration?: number;
  onEnd?: () => void;
}

export function Confetti({
  count = 60,
  colors = ["#ffd75e", "#ff6b6b", "#4ecdc4", "#a29bfe", "#ffeaa7"],
  duration = 1500,
  onEnd,
}: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const rng = mulberry32(Date.now() & 0xffffffff);
    const pieces = Array.from({ length: count }, () => ({
      x: rng() * W,
      y: rng() * H - H,
      vx: (rng() - 0.5) * 4,
      vy: rng() * 3 + 2,
      angle: rng() * Math.PI * 2,
      spin: (rng() - 0.5) * 0.2,
      color: colors[Math.floor(rng() * colors.length)],
      size: 4 + rng() * 6,
    }));

    start.current = performance.now();
    let last = 0;
    const ctxNonNull = ctx!;

    function loop(ts: number) {
      if (!start.current) return;
      raf.current = requestAnimationFrame(loop);
      const elapsed = ts - start.current;
      const p = Math.min(1, elapsed / duration);

      ctxNonNull.clearRect(0, 0, W, H);

      for (const pc of pieces) {
        pc.x += pc.vx;
        pc.y += pc.vy;
        pc.angle += pc.spin;

        ctxNonNull.save();
        ctxNonNull.translate(pc.x, pc.y);
        ctxNonNull.rotate(pc.angle);
        ctxNonNull.globalAlpha = 1 - p;
        ctxNonNull.fillStyle = pc.color;
        ctxNonNull.fillRect(-pc.size / 2, -pc.size / 2, pc.size, pc.size / 2);
        ctxNonNull.restore();
      }

      if (p >= 1) {
        cancelAnimationFrame(raf.current);
        onEnd?.();
      }
      last = ts;
    }

    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [count, colors, duration, onEnd]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "block",
        zIndex: 100,
      }}
      aria-hidden="true"
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  5) PixelFlash — แว๊บขาวเมื่อโดนโจมตี                                    */
/* -------------------------------------------------------------------------- */

interface PixelFlashProps {
  active: boolean;
  duration?: number;
  className?: string;
}

export function PixelFlash({ active, duration = 120, className = "" }: PixelFlashProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    el.classList.add("eq-flash");
    const t = setTimeout(() => {
      el.classList.remove("eq-flash");
    }, duration);
    return () => clearTimeout(t);
  }, [active, duration]);

  return (
    <div ref={ref} className={`pointer-events-none inset-0 absolute ${className}`} />
  );
}

/* -------------------------------------------------------------------------- */
/*  6) PixelHitEffect — เอฟเฟกต์รวม flash + particles + damage number        */
/* -------------------------------------------------------------------------- */

interface PixelHitEffectProps {
  /** ตำแหน่งกลางเอฟเฟกต์ */
  x: number;
  y: number;
  /** ข้อความแสดง (เช่น "+10 XP", "-25 HP") */
  text?: string | null;
  /** สีตัวเลข */
  color?: string;
  /** แสดงอนุภาคหรือไม่ */
  particles?: boolean;
  /** ฟังก์ชันเรียกเมื่อจบ */
  onEnd?: () => void;
}

export function PixelHitEffect({
  x,
  y,
  text,
  color = "#ffd75e",
  particles = true,
  onEnd,
}: PixelHitEffectProps) {
  const [active, setActive] = React.useState(true);
  const [dmgVisible, setDmgVisible] = React.useState(false);

  React.useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      setDmgVisible(true);
      const t2 = setTimeout(() => {
        setActive(false);
        onEnd?.();
      }, 900);
      return () => clearTimeout(t2);
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="pointer-events-none"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 0,
        height: 0,
        zIndex: 60,
      }}
    >
      {active && particles && (
        <PixelParticles count={18} color={color} centerX={0} centerY={0} spread={30} duration={700} />
      )}
      {dmgVisible && text && <DamageNumber value={text} x={0} y={-24} color={color} scale={1.3} duration={800} />}
      {active && <PixelFlash active duration={100} />}
    </div>
  );
}
