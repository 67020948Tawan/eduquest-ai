"use client";

// ==============================================================================
// SiteHeader.tsx — หัวเว็บพร้อมระบบเกมมิฟิเคชัน (XP bar + เลเวล + ธีม)
// ==============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuthToken } from "@/lib/useAuthToken";
import { getCachedUser, logout, type CurrentUser } from "@/lib/api";
import { useTheme } from "@/components/game/ThemeProvider";
import { PixelXPBar } from "@/components/PixelArt";

const THEME_EMOJI: Record<string, string> = {
  pixel_art: "🟦",
  modern_2d: "🎬",
  fantasy: "🧝",
  scifi: "🚀",
  halloween: "🎃",
  cyberpunk: "🤖",
  christmas: "🎄",
  summer: "☀️",
  ocean: "🌊",
  neon: "⚡",
};

export default function SiteHeader() {
  const router = useRouter();
  const token = useAuthToken();
  const { style, setStyle, xp, level, nextLevelXP, unlocked, label } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!themeOpen) return;
    function onDocClick(e: MouseEvent) {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setThemeOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [themeOpen]);

  let user: CurrentUser | null = null;
  if (token) user = getCachedUser();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            🎓
          </span>
          EduQuest <span className="text-indigo-400">AI</span>
        </Link>

        {/* Gamification bar: XP + Level */}
        <div className="flex items-center gap-4 px-4 py-1.5 rounded-full border border-slate-700 bg-slate-900/60">
          <PixelXPBar currentXP={xp} nextLevelXP={nextLevelXP()} level={level} width={160} />
        </div>

        <nav className="flex items-center gap-3">
          {token && user ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                My Games
              </Link>
              <span className="hidden text-sm text-slate-500 sm:block">👤 {user.name}</span>

              {/* Theme switcher dropdown */}
              <div ref={themeRef} className="relative inline-block">
                <button
                  onClick={() => setThemeOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={themeOpen}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white hover:bg-slate-800"
                >
                  <span className="text-lg">{THEME_EMOJI[style] ?? "🎨"}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                    {label(style)}
                  </span>
                  <span className={`text-[10px] transition-transform ${themeOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {themeOpen && (
                  <div
                    role="listbox"
                    className="absolute right-0 z-50 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 py-1 shadow-xl"
                  >
                    {unlocked.map((s) => (
                      <button
                        key={s}
                        role="option"
                        aria-selected={s === style}
                        onClick={() => {
                          setStyle(s);
                          setThemeOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                          s === style
                            ? "bg-indigo-600/30 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <span>{THEME_EMOJI[s] ?? "🎨"}</span>
                        <span className="truncate">{label(s)}</span>
                        {s === style && <span className="ml-auto text-xs text-indigo-300">ใช้อยู่</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleLogout}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-rose-500/50 hover:text-rose-400"
              >
                ออกจากระบบ
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                เข้าสู่ระบบ
              </Link>
              <Link
                href="/login?mode=register"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                เริ่มใช้ฟรี
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
