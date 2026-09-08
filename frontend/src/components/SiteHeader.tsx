"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthToken } from "@/lib/useAuthToken";
import { getCachedUser, logout, type CurrentUser } from "@/lib/api";

export default function SiteHeader() {
  const router = useRouter();
  const token = useAuthToken();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  let user: CurrentUser | null = null;
  if (token) user = getCachedUser();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            🎓
          </span>
          EduQuest <span className="text-indigo-400">AI</span>
        </Link>

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
