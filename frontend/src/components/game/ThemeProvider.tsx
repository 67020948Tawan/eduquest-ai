"use client";

// ==============================================================================
// ThemeProvider — ระบบจัดการธีมภาพ + XP + เลเวลของผู้เล่น (ฝั่ง client)
//
// เก็บใน localStorage:
//   eduquest_theme      → visual style ที่เลือก (pixel_art, halloween, cyberpunk...)
//   eduquest_unlocked   → รายชื่อธีมที่ปลดล็อกแล้ว (array)
//   eduquest_xp         → XP สะสม
//   eduquest_level      → เลเวลปัจจุบัน
//
// คอมโพเนนต์เกม (BattleStage, BaseCanvas, WorldMap) ใช้ useTheme() ดึงธีมปัจจุบัน
// ==============================================================================

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

export type VisualStyle =
  | "pixel_art"
  | "modern_2d"
  | "fantasy"
  | "scifi"
  | "halloween"
  | "cyberpunk"
  | "christmas"
  | "summer"
  | "ocean"
  | "neon";

const THEME_LABELS: Record<VisualStyle, string> = {
  pixel_art: "พิกเซลอาร์ต (เริ่มต้น)",
  modern_2d: "โมเดิร์น 2D",
  fantasy: "แฟนตาซี",
  scifi: "ไซเบอร์/ไซไฟ",
  halloween: "ฮัลโลวีน",
  cyberpunk: "ไซเบอร์พังค์",
  christmas: "คริสต์มาส",
  summer: "ซัมเมอร์",
  ocean: "ทะเลลึก",
  neon: "นีออน",
};

const DEFAULT_STYLE: VisualStyle = "pixel_art";
const THEME_UNLOCK_XP: Record<VisualStyle, number> = {
  pixel_art: 0,
  modern_2d: 200,
  fantasy: 400,
  scifi: 600,
  halloween: 800,
  cyberpunk: 1000,
  christmas: 1200,
  summer: 1400,
  ocean: 1600,
  neon: 2000,
};

interface ThemeContextValue {
  style: VisualStyle;
  setStyle: (s: VisualStyle) => void;
  unlocked: VisualStyle[];
  xp: number;
  level: number;
  addXP: (amount: number) => { leveledUp: boolean; newLevel: number };
  isUnlocked: (s: VisualStyle) => boolean;
  label: (s: VisualStyle) => string;
  nextLevelXP: () => number;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [style, setStyleState] = useState<VisualStyle>(DEFAULT_STYLE);
  const [unlocked, setUnlocked] = useState<VisualStyle[]>([DEFAULT_STYLE]);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);

  // โหลดจาก localStorage ครั้งแรก
  useEffect(() => {
    try {
      const raw = localStorage.getItem("eduquest_theme");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "string" && parsed in THEME_LABELS) {
          setStyleState(parsed as VisualStyle);
        }
      }
      const u = localStorage.getItem("eduquest_unlocked");
      if (u) {
        const arr = JSON.parse(u) as VisualStyle[];
        if (arr.length) setUnlocked(arr);
      }
      const x = localStorage.getItem("eduquest_xp");
      if (x) setXp(Number(x));
      const l = localStorage.getItem("eduquest_level");
      if (l) setLevel(Number(l));
    } catch {
      /* ใช้ค่าเริ่มต้น */
    }
  }, []);

  // persistence
  useEffect(() => {
    localStorage.setItem("eduquest_theme", JSON.stringify(style));
  }, [style]);
  useEffect(() => {
    localStorage.setItem("eduquest_unlocked", JSON.stringify(unlocked));
  }, [unlocked]);
  useEffect(() => {
    localStorage.setItem("eduquest_xp", JSON.stringify(xp));
  }, [xp]);
  useEffect(() => {
    localStorage.setItem("eduquest_level", JSON.stringify(level));
  }, [level]);

  const setStyle = useCallback((s: VisualStyle) => {
    if (unlocked.includes(s)) setStyleState(s);
  }, [unlocked]);

  const nextLevelXP = useCallback(() => 100 + (level - 1) * 50, [level]);

  const addXP = useCallback(
    (amount: number) => {
      let newXP = xp + amount;
      let newLevel = level;
      let leveledUp = false;
      const need = nextLevelXP();
      while (newXP >= need) {
        newXP -= need;
        newLevel += 1;
        leveledUp = true;
      }
      setXp(newXP);
      setLevel(newLevel);

      // ปลดล็อกธีมใหม่เมื่อถึง XP ที่กำหนด
      setUnlocked((prev) => {
        const next = [...prev];
        for (const [s, reqXP] of Object.entries(THEME_UNLOCK_XP)) {
          if (!next.includes(s as VisualStyle) && newLevel * 1 >= Math.ceil(reqXP / 50)) {
            next.push(s as VisualStyle);
          }
        }
        return next;
      });

      return { leveledUp, newLevel };
    },
    [xp, level, nextLevelXP]
  );

  const isUnlocked = useCallback((s: VisualStyle) => unlocked.includes(s), [unlocked]);

  const value: ThemeContextValue = {
    style,
    setStyle,
    unlocked,
    xp,
    level,
    addXP,
    isUnlocked,
    label: (s) => THEME_LABELS[s],
    nextLevelXP,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme ต้องใช้ภายใน ThemeProvider");
  return ctx;
}
