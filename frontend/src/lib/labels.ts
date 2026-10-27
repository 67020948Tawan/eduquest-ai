// ==============================================================================
// labels.ts — ป้ายข้อความกลาง (สถานะคอร์ส / โหมดเกม / สไตล์ภาพ)
// ใช้ร่วมกันทุกหน้า เพื่อไม่ให้แต่ละหน้าแปลชื่อเองแล้วไม่ตรงกัน
// ==============================================================================

import type { CourseStatus, VisualStyle } from "./api";

export const STATUS_META: Record<CourseStatus, { label: string; className: string }> = {
  DRAFT: { label: "📝 ฉบับร่าง", className: "bg-slate-800 text-slate-300" },
  GENERATING: { label: "⏳ กำลังสร้าง", className: "bg-amber-950/60 text-amber-300" },
  READY: { label: "✅ พร้อมเล่น", className: "bg-emerald-950/60 text-emerald-300" },
  PUBLISHED: { label: "🚀 เผยแพร่แล้ว", className: "bg-indigo-950/60 text-indigo-300" },
  ARCHIVED: { label: "📦 เก็บถาวร", className: "bg-slate-900 text-slate-500" },
};

export function statusMeta(status: string) {
  return STATUS_META[status as CourseStatus] ?? STATUS_META.DRAFT;
}

const GAME_MODE_LABELS: Record<string, string> = {
  standard_quiz: "แบบทดสอบ",
  rpg_lore: "ผจญภัย RPG",
  turn_based: "ต่อสู้ผลัดกัน",
  base_building: "สร้างฐาน",
};

export function gameModeLabel(mode: string): string {
  return GAME_MODE_LABELS[mode] ?? mode.replace(/_/g, " ");
}

const VISUAL_STYLE_LABELS: Record<VisualStyle, string> = {
  pixel_art: "พิกเซลอาร์ต",
  modern_2d: "โมเดิร์น 2D",
  fantasy: "แฟนตาซี",
  scifi: "ไซไฟ",
};

export function visualStyleLabel(style: string): string {
  return VISUAL_STYLE_LABELS[style as VisualStyle] ?? style.replace(/_/g, " ");
}
