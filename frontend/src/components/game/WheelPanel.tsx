"use client";

// ==============================================================================
// WheelPanel — วงล้อสุ่มคำถาม (โหมด "wheel")
// ผู้เล่นกดหมุน → วงล้อหมุน ~3 วิ → หยุดที่ช่องของคำถามที่ถูกสุ่มไว้แล้ว
// จากนั้นหน้า chapter จะเปิดการ์ดคำถามของช่องนั้นให้ตอบ
// (คำถามยังถูกตรวจ + อนุมัติ XP ฝั่ง server ตามกติกา anti-cheat เหมือนเดิม)
// ==============================================================================

import { useEffect, useRef, useState } from "react";

export interface WheelWedge {
  emoji: string;
  label: string;
  color: string;
}

const SEG_STROKE = "#1e293b";

function wedgePath(index: number, total: number, radius: number): string {
  const startAngle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const endAngle = ((index + 1) / total) * Math.PI * 2 - Math.PI / 2;
  const cx = 150;
  const cy = 150;
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function wedgeLabelTransform(index: number, total: number): string {
  const mid = (index + 0.5) * (360 / total) - 90;
  return `rotate(${mid + 90} 150 150) translate(100 150) rotate(${-(mid + 90)})`;
}

export default function WheelPanel({
  wedges,
  landingIndex,
  spinning,
  remaining,
  total,
  onSpin,
}: {
  wedges: WheelWedge[];
  /** index ของช่องที่จะหยุด (null = ยังไม่หมุน) */
  landingIndex: number | null;
  spinning: boolean;
  remaining: number;
  total: number;
  onSpin: () => void;
}) {
  const [rotation, setRotation] = useState(0);
  const currentRef = useRef(0);

  useEffect(() => {
    if (landingIndex === null || !spinning) return;
    const n = Math.max(1, wedges.length);
    const seg = 360 / n;
    // ชี้อยู่ที่เข็มบน (12 นาฬิกา) → หมุนไปหยุดกึ่งกลางช่อง landingIndex
    const target = (360 - ((landingIndex + 0.5) * seg) % 360) % 360;
    const current = currentRef.current % 360;
    const turns = 4 * 360;
    const next = currentRef.current + turns + ((target - current + 360) % 360);
    currentRef.current = next;
    setRotation(next);
  }, [landingIndex, spinning, wedges.length]);

  const disabled = spinning || remaining <= 0;

  return (
    <div className="eq-pop mt-5 rounded-2xl border border-amber-700/40 bg-gradient-to-b from-amber-950/20 to-slate-900/50 p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-black text-amber-300">🎡 วงล้อสุ่มคำถาม</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            กดหมุนได้เลย — วงล้อหยุดช่องไหนก็ตอบคำถามช่องนั้น
          </p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-bold text-slate-300">
          เหลืออีก {remaining}/{total} ข้อ
        </span>
      </div>

      <div className="flex flex-col items-center">
        <div className="relative">
          {/* เข็มชี้ */}
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
            <div className="h-0 w-0 border-x-[10px] border-t-[20px] border-x-transparent border-t-amber-400 drop-shadow" />
          </div>
          <svg
            width="300"
            height="300"
            viewBox="0 0 300 300"
            className="drop-shadow-xl"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: spinning
                ? "transform 3s cubic-bezier(0.12, 0.8, 0.16, 1)"
                : undefined,
            }}
          >
            {wedges.map((w, i) => {
              const isLanding = landingIndex === i && !spinning;
              return (
                <g key={i}>
                  <path
                    d={wedgePath(i, wedges.length, 140)}
                    fill={w.color}
                    stroke={SEG_STROKE}
                    strokeWidth="2"
                    opacity={isLanding ? 1 : 0.92}
                  />
                  <text
                    transform={wedgeLabelTransform(i, wedges.length)}
                    textAnchor="middle"
                    className="select-none"
                    fill="#f8fafc"
                    fontSize="13"
                    fontWeight="700"
                  >
                    <tspan x="0" dy="-2" fontSize="20">
                      {w.emoji}
                    </tspan>
                    <tspan x="0" dy="20" fontSize="12">
                      {w.label}
                    </tspan>
                  </text>
                </g>
              );
            })}
            {/* แกนกลาง */}
            <circle cx="150" cy="150" r="26" fill="#0f172a" stroke="#fbbf24" strokeWidth="3" />
            <text x="150" y="156" textAnchor="middle" fontSize="20">
              🎡
            </text>
          </svg>
        </div>

        <button
          type="button"
          onClick={onSpin}
          disabled={disabled}
          className="mt-6 w-full max-w-sm rounded-xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 px-6 py-3.5 text-lg font-black text-slate-950 shadow-lg shadow-amber-900/40 transition-all hover:scale-[1.01] hover:from-amber-300 hover:via-orange-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {spinning ? "กำลังหมุน..." : remaining <= 0 ? "ตอบครบแล้ว 🎉" : "🎡 หมุนวงล้อ!"}
        </button>
      </div>
    </div>
  );
}
