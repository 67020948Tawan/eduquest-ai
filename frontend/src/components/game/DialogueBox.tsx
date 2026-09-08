"use client";

// ==============================================================================
// DialogueBox.tsx — RPG NPC Dialogue (typewriter effect)
// ==============================================================================

import { useEffect, useState } from "react";
import { PixelSprite } from "@/components/PixelArt";

export interface DialogueNpc {
  name: string;
  role: string;
  dialogue: string;
}

export default function DialogueBox({
  npc,
  chapterTitle,
  objective,
  visualStyle,
  onClose,
}: {
  npc: DialogueNpc;
  chapterTitle: string;
  objective?: string;
  visualStyle: string;
  onClose: () => void;
}) {
  const fullText = npc.dialogue + (objective ? `\n\nภารกิจของเราคือ: ${objective}` : "");
  // shown เริ่มที่ 0 ทุกครั้งที่ mount — parent ใช้ key เปลี่ยน npc/chapter เพื่อ reset
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setShown((prev) => {
        if (prev >= fullText.length) {
          clearInterval(timer);
          return prev;
        }
        return prev + 2;
      });
    }, 24);
    return () => clearInterval(timer);
  }, [fullText]);

  const done = shown >= fullText.length;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => (done ? onClose() : setShown(fullText.length))}
    >
      <div
        className="w-full max-w-xl rounded-2xl border-2 border-indigo-500/60 bg-slate-900 p-5 shadow-2xl shadow-indigo-950/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-xl border border-slate-700 bg-slate-950 p-1.5">
            <PixelSprite kind="npc" seed={npc.name} style={visualStyle} size={56} floating />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-indigo-300">{npc.name}</p>
            <p className="text-xs text-slate-500">{npc.role} · {chapterTitle}</p>
            <p className="mt-3 min-h-[72px] whitespace-pre-line text-sm leading-relaxed text-slate-200">
              {fullText.slice(0, shown)}
              {!done && <span className="animate-pulse">▌</span>}
            </p>
          </div>
        </div>

        <button
          onClick={() => (done ? onClose() : setShown(fullText.length))}
          className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold transition hover:bg-indigo-500"
        >
          {done ? "ต่อไป ▶" : "ข้าม ▶▶"}
        </button>
      </div>
    </div>
  );
}
