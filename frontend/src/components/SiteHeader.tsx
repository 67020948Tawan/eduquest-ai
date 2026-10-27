"use client";

// ==============================================================================
// SiteHeader.tsx — หัวเว็บหลัก
// ==============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthToken } from "@/lib/useAuthToken";
import { getCachedUser, logout, type CurrentUser } from "@/lib/api";

export default function SiteHeader() {
  const router = useRouter();
  const token = useAuthToken();

  let user: CurrentUser | null = null;
  if (token) user = getCachedUser();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            🎓
          </span>
          EduQuest <span className="text-indigo-400">AI</span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-3">
          {token && user ? (
            <>
              <Link
                href="/dashboard"
                className="whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:text-white sm:px-4 sm:text-sm"
              >
                เกมของฉัน
              </Link>
              <Link
                href="/profile"
                className="hidden text-sm text-slate-500 transition hover:text-slate-300 sm:block"
              >
                👤 {user.name}
              </Link>

              <button
                onClick={handleLogout}
                className="whitespace-nowrap rounded-lg border border-slate-700 px-2.5 py-2 text-xs text-slate-300 transition hover:border-rose-500/50 hover:text-rose-400 sm:px-4 sm:text-sm"
              >
                ออกจากระบบ
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 transition hover:text-white sm:px-4 sm:text-sm"
              >
                เข้าสู่ระบบ
              </Link>
              <Link
                href="/login?mode=register"
                className="whitespace-nowrap rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 sm:px-4 sm:text-sm"
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
