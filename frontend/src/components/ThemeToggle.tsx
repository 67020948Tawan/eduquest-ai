"use client";

// ==============================================================================
// ThemeToggle — ปุ่มสลับโหมดกลางวัน/กลางคืน
// เก็บค่าที่เลือกไว้ใน localStorage ("eduquest_theme") — ค่าเริ่มต้นคือกลางคืน
// (script ใน layout ตั้ง data-theme บน <html> ตั้งแต่ก่อน render เพื่อไม่ให้จอกะพริบ)
// ==============================================================================

import { useEffect, useState } from "react";

const STORAGE_KEY = "eduquest_theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const current =
        document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      setTheme(saved === "light" || saved === "dark" ? saved : current);
    } catch {
      setTheme("dark");
    }
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  // รอ mount กัน hydration mismatch (server ไม่รู้ค่าที่บันทึกไว้)
  if (theme === null) {
    return (
      <span
        aria-hidden
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent opacity-0 ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "light" ? "สลับเป็นโหมดกลางคืน" : "สลับเป็นโหมดกลางวัน"}
      aria-label={theme === "light" ? "สลับเป็นโหมดกลางคืน" : "สลับเป็นโหมดกลางวัน"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 text-base transition hover:border-indigo-500 hover:bg-indigo-950/40 ${className}`}
    >
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}
