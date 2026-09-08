"use client";

// ==============================================================================
// BasePanel.tsx — Base Building UI v2
// Live canvas + เก็บผลผลิต + Raid defense (ตอบคำถามขับไล่) + ก่อสร้าง
// ==============================================================================

import { useCallback, useEffect, useState } from "react";
import {
  BUILDING_CATALOG,
  RESOURCE_META,
  buildBuilding,
  collectProduction,
  defendRaid,
  getRaidQuestion,
  getSessionStatus,
  type GameState,
  type RaidQuestion,
  type Resources,
  type SessionStatus,
} from "@/lib/api";
import { PixelBuilding } from "@/components/PixelArt";
import BaseCanvas from "@/components/game/BaseCanvas";

const RES_ORDER: (keyof Resources)[] = ["gold", "wood", "stone", "crystal", "knowledge"];

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function BasePanel({
  sessionId,
  gameState,
  totalChapters,
  completedCount,
  visualStyle,
  onChanged,
  notify,
  onXpUpdate,
}: {
  sessionId: number;
  gameState: GameState;
  totalChapters: number;
  completedCount: number;
  visualStyle: string;
  onChanged: (gs: GameState) => void;
  notify: (msg: string, ok: boolean) => void;
  onXpUpdate?: (totalXp: number) => void;
}) {
  const resources = gameState.resources;

  // ---- Server status polling (pending + raid) ----
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [collecting, setCollecting] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getSessionStatus(sessionId);
      setStatus(s);
      if (s.notice) notify(s.notice, false);
    } catch {
      /* silent */
    }
  }, [sessionId, notify]);

  useEffect(() => {
    let alive = true;
    // defer initial fetch ออกจาก effect body (กฎ react-hooks/set-state-in-effect)
    const t0 = setTimeout(() => {
      if (alive) refreshStatus();
    }, 0);
    const t = setInterval(() => {
      if (alive) refreshStatus();
    }, 12000);
    return () => {
      alive = false;
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [refreshStatus]);

  // 1s clock สำหรับ countdown raid
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleCollect() {
    setCollecting(true);
    try {
      const res = await collectProduction(sessionId);
      onChanged(res.game_state);
      notify(res.message, true);
      await refreshStatus();
    } catch (err) {
      notify(err instanceof Error ? err.message : "เก็บไม่สำเร็จ", false);
    } finally {
      setCollecting(false);
    }
  }

  // ---- Raid defense ----
  const raid = status?.raid ?? null;
  const [raidQ, setRaidQ] = useState<RaidQuestion | null>(null);
  const [raidSel, setRaidSel] = useState<number | null>(null);
  const [raidBusy, setRaidBusy] = useState(false);
  const [raidMsg, setRaidMsg] = useState<string | null>(null);

  const remainingMs = raid ? Math.max(0, raid.ends_at - (nowMs ?? 0)) : 0;
  const pendingTotal = Object.values(status?.pending ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  async function startDefense() {
    setRaidBusy(true);
    setRaidMsg(null);
    try {
      const q = await getRaidQuestion(sessionId);
      setRaidQ(q);
      setRaidSel(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : "โหลดคำถามไม่ได้", false);
    } finally {
      setRaidBusy(false);
    }
  }

  async function submitDefense() {
    if (!raidQ || raidSel === null) return;
    setRaidBusy(true);
    try {
      const res = await defendRaid(sessionId, {
        question_id: raidQ.question_id,
        answer_index: raidSel,
      });
      onChanged(res.game_state);
      setRaidMsg(res.message);

      if (res.repelled) {
        notify(res.message, true);
        if (res.total_xp != null) onXpUpdate?.(res.total_xp);
        setRaidQ(null);
        setRaidSel(null);
        await refreshStatus();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "ส่งคำตอบไม่ได้", false);
    } finally {
      setRaidBusy(false);
    }
  }

  function unlockRequired(b: { unlock_chapters: number }): number {
    if (b.unlock_chapters <= 0 || totalChapters === 0) return 0;
    return Math.max(1, Math.round((totalChapters * b.unlock_chapters) / 3));
  }

  async function handleBuild(id: string) {
    setBuildingId(id);
    try {
      const res = await buildBuilding(sessionId, id);
      onChanged(res.game_state);
      notify(res.message, true);
      await refreshStatus();
    } catch (err) {
      notify(err instanceof Error ? err.message : "สร้างไม่สำเร็จ", false);
    } finally {
      setBuildingId(null);
    }
  }

  const [buildingId, setBuildingId] = useState<string | null>(null);

  return (
    <section className="space-y-5">
      {/* ===== RAID ALERT ===== */}
      {raid && (
        <div className="eq-pop overflow-hidden rounded-2xl border-2 border-rose-600/70 bg-gradient-to-r from-rose-950/80 via-red-950/70 to-rose-950/80 shadow-xl shadow-rose-950/40">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="text-3xl" style={{ animation: "eq-shake 0.6s infinite" }}>
              👹
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-black text-rose-200">
                {raid.name} กำลังบุกฐานของคุณ!
              </p>
              <p className="text-xs text-rose-300/90">
                ⏳ อีก {fmtCountdown(remainingMs)} — ถ้าหมดเวลาจะปล้นทรัพยากร 10%
              </p>
            </div>
            {!raidQ && (
              <button
                onClick={startDefense}
                disabled={raidBusy}
                className="rounded-xl bg-gradient-to-r from-rose-600 to-red-500 px-6 py-3 font-bold text-white shadow-lg shadow-rose-900/50 transition hover:from-rose-500 hover:to-red-400 disabled:opacity-60"
              >
                🛡️ ขับไล่ด้วยความรู้!
              </button>
            )}
          </div>

          {/* Defense quiz */}
          {raidQ && (
            <div className="border-t border-rose-800/50 bg-slate-950/40 p-4">
              <p className="mb-3 font-semibold text-slate-100">🛡️ {raidQ.question}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {raidQ.options.map((opt, i) => {
                  const sel = raidSel === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setRaidSel(i)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        sel
                          ? "border-amber-400 bg-amber-950/40 text-amber-200 ring-1 ring-amber-400"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/60"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {raidMsg && <p className="mt-2 text-sm text-amber-300">{raidMsg}</p>}
              <button
                onClick={submitDefense}
                disabled={raidSel === null || raidBusy}
                className="mt-3 w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 font-bold text-slate-950 transition hover:from-amber-400 disabled:opacity-50"
              >
                {raidBusy ? "กำลังตรวจ..." : "⚔️ ป้องกันฐาน!"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== LIVE BASE VIEW ===== */}
      <div className="relative space-y-3">
        <BaseCanvas
          buildings={gameState.buildings}
          style={visualStyle}
          pendingByBuilding={status?.pending_per_building ?? {}}
        />

        {/* Collect button */}
        <button
          onClick={handleCollect}
          disabled={collecting || pendingTotal < 1}
          title="เก็บผลผลิตที่อาคารสะสมไว้"
          className={`absolute bottom-3 right-3 rounded-xl px-5 py-2.5 text-sm font-black shadow-xl transition-all active:scale-95 ${
            pendingTotal >= 1
              ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 hover:from-emerald-400 hover:to-teal-400"
              : "cursor-not-allowed bg-slate-900/85 text-slate-500 backdrop-blur"
          }`}
        >
          {collecting
            ? "กำลังเก็บ..."
            : pendingTotal >= 1
              ? `📦 เก็บผลผลิต (${pendingTotal})`
              : "📦 ผลผลิตกำลังสะสม..."}
        </button>
      </div>

      {/* Production legend */}
      {gameState.buildings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gameState.buildings.map((id) => {
            const b = BUILDING_CATALOG[id];
            const y = PASSIVE_YIELD_MAP[id];
            const yieldTxt = y
              ? Object.entries(y)
                  .map(([k, v]) => `${RESOURCE_META[k as keyof Resources].icon}${v}/นาที`)
                  .join(" ")
              : "";
            return (
              <span
                key={id}
                className="rounded-full border border-emerald-800/50 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300"
              >
                {b.icon} {b.name} · {yieldTxt || b.effect_text}
              </span>
            );
          })}
        </div>
      )}

      {/* Resource counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {RES_ORDER.map((key) => (
          <div
            key={key}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-600"
          >
            <p className="text-xl">{RESOURCE_META[key].icon}</p>
            <p className="mt-1 text-lg font-bold text-slate-100">
              {(resources[key] ?? 0).toLocaleString()}
            </p>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              {RESOURCE_META[key].label}
            </p>
          </div>
        ))}
      </div>

      <p className="text-sm text-slate-400">
        💡 ตอบถูก = 💰🪵 (ยิ่งยาก×streak ยิ่งได้เยอะ) · อาคาร **ผลิตเองทุกนาที** — อย่าลืมกด 📦 เก็บ ·
        ระวัง 👹 Raid บุก!
      </p>

      {/* Buildings grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(BUILDING_CATALOG).map(([id, b]) => {
          const built = gameState.buildings.includes(id);
          const needChapters = unlockRequired(b);
          const chapterLocked = completedCount < needChapters;
          const reqMissing = (b.requires ?? []).filter((r) => !gameState.buildings.includes(r));
          const afford = (Object.entries(b.cost) as [keyof Resources, number][]).every(
            ([k, v]) => (resources[k] ?? 0) >= v
          );
          const canBuild = !built && !chapterLocked && reqMissing.length === 0 && afford;
          const yields = PASSIVE_YIELD_MAP[id];

          return (
            <div
              key={id}
              className={`rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 ${
                built
                  ? "border-emerald-700/60 bg-emerald-950/20 shadow-lg shadow-emerald-950/40"
                  : canBuild
                    ? "border-indigo-600/50 bg-slate-900/70 shadow-lg shadow-indigo-900/20 hover:border-indigo-400"
                    : "border-slate-800 bg-slate-950/60 opacity-80"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`shrink-0 ${built ? "" : chapterLocked ? "grayscale" : ""}`}>
                  <PixelBuilding buildingId={id} style={visualStyle} size={56} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="truncate font-bold">{b.icon} {b.name}</h4>
                    {built && <span className="shrink-0 text-xs text-emerald-400">✓</span>}
                  </div>

                  {yields ? (
                    <p className="mt-0.5 text-xs text-emerald-300/90">
                      ผลิต:{" "}
                      {Object.entries(yields).map(([k, v]) => (
                        <span key={k} className="mr-1.5">
                          {RESOURCE_META[k as keyof Resources].icon}{v}/นาที
                        </span>
                      ))}
                      <span className="ml-1 text-slate-500">(คลัง {STORAGE_CAP_MAP[id]})</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-emerald-300/90">{b.effect_text}</p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(Object.entries(b.cost) as [keyof Resources, number][]).map(([k, v]) => {
                      const enough = (resources[k] ?? 0) >= v;
                      return (
                        <span
                          key={k}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            enough ? "bg-slate-800 text-slate-200" : "bg-rose-950/60 text-rose-300"
                          }`}
                        >
                          {RESOURCE_META[k].icon} {v}
                        </span>
                      );
                    })}
                  </div>

                  {!built && chapterLocked && (
                    <p className="mt-2 text-xs text-amber-400">
                      🔒 ต้องจบ Chapter ครบ {needChapters} (ปัจจุบัน {completedCount})
                    </p>
                  )}
                  {!built && reqMissing.length > 0 && (
                    <p className="mt-2 text-xs text-amber-400">
                      🔒 ต้องมี: {reqMissing.map((r) => BUILDING_CATALOG[r]?.name).join(", ")}
                    </p>
                  )}

                  {!built && (
                    <button
                      onClick={() => handleBuild(id)}
                      disabled={!canBuild || buildingId !== null}
                      className={`mt-3 w-full rounded-lg py-2 text-sm font-bold transition ${
                        canBuild
                          ? "bg-indigo-600 text-white hover:bg-indigo-500"
                          : "cursor-not-allowed bg-slate-800 text-slate-500"
                      }`}
                    >
                      {buildingId === id
                        ? "กำลังสร้าง..."
                        : chapterLocked
                          ? "🔒 ยังปลดล็อกไม่ได้"
                          : afford
                            ? "🏗️ สร้าง"
                            : "ทรัพยากรไม่พอ"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Mirror PASSIVE_YIELD / STORAGE_CAP (backend/services/game_catalog.py)
const PASSIVE_YIELD_MAP: Record<string, Partial<Record<keyof Resources, number>>> = {
  house: { gold: 2 },
  farm: { gold: 6 },
  mine: { stone: 4 },
  workshop: { wood: 3 },
  library: { knowledge: 1 },
  academy: { knowledge: 1 },
  castle: { crystal: 1 },
};

const STORAGE_CAP_MAP: Record<string, number> = {
  house: 40, farm: 80, mine: 60, workshop: 50, library: 20, academy: 20, castle: 10,
};
