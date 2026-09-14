"use client";

// ==============================================================================
// WorldMapView — แผนที่โลกแบบเกมจริง
// โหนดด่านเรียงตามเส้นทางคดเคี้ยว + เส้นทางเชื่อม + ตัวละครผู้เล่นเดินไปตามจุด
// PC/มือถือ ใช้เหมือนกัน (แนวตั้ง เลื่อนดูได้)
// ==============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { PixelSprite } from "@/components/PixelArt";

export interface MapNode {
  key: string | number;
  title: string;
  subtitle: string;
  icon: string;
  state: "done" | "current" | "locked";
  progressText: string;
  isBoss?: boolean;
}

const ROW_H = 150;
const TOP_PAD = 80;
const BOTTOM_PAD = 90;
const XS = [50, 22, 50, 78];

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export default function WorldMapView({
  nodes,
  visualStyle,
  onOpen,
}: {
  nodes: MapNode[];
  visualStyle: string;
  onOpen: (index: number) => void;
}) {
  const H = nodes.length * ROW_H + TOP_PAD + BOTTOM_PAD;
  const count = nodes.length;
  const pts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: XS[i % XS.length],
        y: TOP_PAD + i * ROW_H,
      })),
    [count]
  );
  const d = smoothPath(pts);

  // ตำแหน่งผู้เล่น = โหนดปัจจุบัน (โหนดแรกที่ยังไม่จบ) — เดินไปเมื่อกด
  // ถ้าจบหมดแล้วให้ยืนที่โหนดสุดท้าย
  const foundCurrent = nodes.findIndex((n) => n.state === "current");
  const currentIdx = foundCurrent === -1 ? Math.max(0, nodes.length - 1) : foundCurrent;
  const [pos, setPos] = useState(pts[currentIdx] ?? { x: 50, y: 80 });
  const [walking, setWalking] = useState(false);
  const walkingRef = useRef(false);

  // sync เมื่อ progress เปลี่ยนจากข้างนอก (จบด่านแล้วกลับมา)
  useEffect(() => {
    if (!walkingRef.current) setPos(pts[currentIdx] ?? { x: 50, y: 80 });
  }, [currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleNodeClick(i: number) {
    if (walkingRef.current || nodes[i].state === "locked") return;
    const from = { ...pos };
    const to = pts[i];
    // ถ้ากดโหนดที่ยืนอยู่แล้ว → เปิดเลย
    if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) {
      onOpen(i);
      return;
    }
    walkingRef.current = true;
    setWalking(true);
    const dur = 650;
    let t0 = -1;
    function step(t: number) {
      if (t0 < 0) t0 = t;
      const k = Math.min(1, (t - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setPos({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (k < 1) {
        requestAnimationFrame(step);
      } else {
        t0 = -1;
        walkingRef.current = false;
        setWalking(false);
        onOpen(i);
      }
    }
    requestAnimationFrame(step);
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
      style={{ height: H }}
    >
      {/* พื้นหลังแผนที่ */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 30% at 50% 0%, rgba(99,102,241,0.12), transparent 70%)," +
            "radial-gradient(ellipse 60% 25% at 50% 100%, rgba(16,185,129,0.08), transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.25) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(148,163,184,0.25) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* เส้นทาง */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 100 ${H}`}
        preserveAspectRatio="none"
      >
        <path
          d={d}
          fill="none"
          stroke="#475569"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="5 4"
          opacity="0.9"
        />
        <path
          d={d}
          fill="none"
          stroke="#818cf8"
          strokeWidth="0.7"
          strokeLinecap="round"
          strokeDasharray="1.5 6"
          opacity="0.7"
        />
      </svg>

      {/* โหนดด่าน */}
      {nodes.map((n, i) => (
        <button
          key={n.key}
          onClick={() => handleNodeClick(i)}
          disabled={n.state === "locked" || walking}
          aria-label={n.title}
          className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pts[i].x}%`, top: pts[i].y }}
        >
          <span
            className={`grid place-items-center rounded-full border-2 transition-all duration-200 ${
              n.isBoss ? "h-16 w-16 text-2xl" : "h-14 w-14 text-xl"
            } ${
              n.state === "done"
                ? "border-emerald-500/70 bg-emerald-950/80 shadow-lg shadow-emerald-950/60 group-hover:scale-110"
                : n.state === "current"
                  ? "eq-glow border-indigo-400 bg-indigo-950/80 group-hover:scale-110"
                  : "border-slate-700 bg-slate-900/90 opacity-70 grayscale"
            }`}
          >
            {n.state === "locked" ? "🔒" : n.isBoss ? "👑" : n.icon}
          </span>
          <span
            className={`mx-auto mt-1.5 block w-28 truncate rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold backdrop-blur ${
              n.state === "locked"
                ? "bg-slate-950/70 text-slate-500"
                : n.state === "done"
                  ? "bg-emerald-950/70 text-emerald-300"
                  : "bg-indigo-950/70 text-indigo-200"
            }`}
          >
            {i + 1}. {n.title}
          </span>
          <span className="mx-auto mt-0.5 block w-fit rounded bg-slate-950/70 px-1.5 text-[10px] text-slate-400 backdrop-blur">
            {n.state === "locked" ? "🔒" : n.progressText}
          </span>
        </button>
      ))}

      {/* ตัวละครผู้เล่น — เดินตามเส้นทาง */}
      <div
        className="pointer-events-none absolute z-20 -translate-x-1/2"
        style={{
          left: `${pos.x}%`,
          top: pos.y - 52,
          transition: "none",
        }}
      >
        <div className={walking ? "animate-bounce" : "eq-float-idle"}>
          <PixelSprite kind="hero" seed="player-hero" style={visualStyle} size={44} />
        </div>
      </div>
    </div>
  );
}

