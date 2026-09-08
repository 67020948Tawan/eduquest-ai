"use client";

// ==============================================================================
// ShareModal.tsx — แชร์เกม: Copy Link · QR Code · Native Share (มือถือ)
// ==============================================================================

import { useMemo, useState } from "react";
import { shareUrl } from "@/lib/api";

export default function ShareModal({
  title,
  sharePath,
  shareCode,
  onClose,
  onCopied,
}: {
  title: string;
  sharePath: string;
  shareCode?: string | null;
  onClose: () => void;
  onCopied?: () => void;
}) {
  const url = useMemo(() => shareUrl(sharePath), [sharePath]);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyCode() {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
    } catch {
      /* ignore */
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text: `มาเล่นเกมการเรียนรู้ "${title}" กัน!`, url });
        return;
      } catch {
        /* user cancelled — fall through to modal */
      }
    }
  }

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="eq-pop w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">🔗 Share your game</h3>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-lg px-2.5 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Link */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 p-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-300 outline-none"
            aria-label="Game link"
          />
          <button
            onClick={copy}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold transition ${
              copied
                ? "bg-emerald-500 text-slate-950"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        {/* Join code */}
        {shareCode && (
          <button
            onClick={copyCode}
            title="กดเพื่อคัดลอกรหัส"
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-600/40 bg-amber-950/30 px-4 py-3 transition hover:border-amber-500 hover:bg-amber-950/50"
          >
            <span className="text-left">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-amber-400/80">
                🎟️ รหัสเข้าห้อง
              </span>
              <span className="block font-mono text-2xl font-black tracking-[0.3em] text-amber-200">
                {shareCode}
              </span>
            </span>
            <span className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-200">
              {codeCopied ? "✓ คัดลอกแล้ว" : "คัดลอกรหัส"}
            </span>
          </button>
        )}

        {/* QR + native share */}
        <div className="mt-5 flex items-center gap-5">
          <div className="shrink-0 rounded-xl bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="QR Code สำหรับเปิดเกม" width={120} height={120} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <a
              href={qrSrc}
              download={`${title}-qr.png`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 px-3 py-2 text-center text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              ⬇ Download QR
            </a>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button
                onClick={nativeShare}
                className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-pink-600 px-3 py-2 text-sm font-bold text-white transition hover:from-fuchsia-500"
              >
                📤 Share to apps...
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          นักเรียนสแกน QR หรือเปิดลิงก์ได้ทันทีบนมือถือ แท็บเล็ต หรือคอมพิวเตอร์ — ไม่ต้องติดตั้งแอป
        </p>
      </div>
    </div>
  );
}
