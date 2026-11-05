"use client";

// ==============================================================================
// DungeonView — แผนที่ดันเจี้ยน RPG ต่อบท
//
// ลำดับชั้น: แผนที่ห้อง → เดินเข้าห้อง → เก็บของ/กุญแจ/กับดัก → ตอบคำถามห้อง quiz
//            → ห้องบอส (หลายเฟส) → กลับไปจบบทที่หน้า chapter ปกติ
// สถานะจริงทั้งหมดอยู่ฝั่งเซิร์ฟเวอร์ (game_state["dungeon"]) — ที่นี่แค่แสดงผล
// ==============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { BattleStage, type BattlePhase } from "@/components/PixelArt";
import WorldMapView, { type MapNode } from "@/components/game/WorldMapView";
import {
  attackDungeonBoss,
  enterDungeonRoom,
  getDungeon,
  getDungeonBossQuestion,
  useDungeonItem,
  type ChapterView,
  type DungeonBossAttackResult,
  type DungeonBossQuestion,
  type DungeonPayload,
  type DungeonRoomView,
  type GameState,
} from "@/lib/api";

const ROOM_ICON: Record<DungeonRoomView["type"], string> = {
  quiz: "❓",
  treasure: "🎁",
  trap: "⚠️",
  npc: "💬",
  boss: "👑",
};

const ROOM_LABEL: Record<DungeonRoomView["type"], string> = {
  quiz: "ห้องคำถาม",
  treasure: "ห้องสมบัติ",
  trap: "กับดัก",
  npc: "เรื่องเล่า",
  boss: "ห้องบอส",
};

export default function DungeonView({
  sessionId,
  chapter,
  visualStyle,
  answeredMap,
  onExit,
  onEnterQuizRoom,
  onBossCleared,
  onXp,
  onGameState,
  notify,
}: {
  sessionId: number;
  chapter: ChapterView;
  visualStyle: string;
  answeredMap: Record<string, boolean>;
  onExit: () => void;
  onEnterQuizRoom: (room: DungeonRoomView) => void;
  onBossCleared: () => void;
  onXp: (xp: number) => void;
  onGameState: (state: GameState) => void;
  notify: (msg: string, ok?: boolean) => void;
}) {
  const [dungeon, setDungeon] = useState<DungeonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Boss battle
  const [bossQ, setBossQ] = useState<DungeonBossQuestion | null>(null);
  const [bossLoading, setBossLoading] = useState(false);
  const [bossBusy, setBossBusy] = useState(false);
  const [bossError, setBossError] = useState<string | null>(null);
  const [bossFeedback, setBossFeedback] = useState<DungeonBossAttackResult | null>(null);
  const [bossPhase, setBossPhase] = useState<BattlePhase>("idle");
  const [chosen, setChosen] = useState<number | null>(null);

  const chapterId = chapter.chapter_id;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDungeon(sessionId, chapterId);
      setDungeon(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดแผนที่ดันเจี้ยนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [sessionId, chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const state = dungeon?.state;
  const rooms = dungeon?.rooms ?? [];
  const currentRoom = useMemo(
    () => rooms.find((r) => r.id === state?.room) ?? null,
    [rooms, state?.room]
  );

  const pendingQuizIds = useMemo(
    () =>
      (currentRoom?.question_ids ?? []).filter(
        (id) => answeredMap[String(id)] === undefined
      ),
    [currentRoom, answeredMap]
  );

  async function handleEnter(roomId: string) {
    if (!dungeon || busy) return;
    setBusy(roomId);
    try {
      const res = await enterDungeonRoom(sessionId, chapterId, roomId);
      setDungeon(res);
      onGameState(res.game_state);
      for (const ev of res.events) {
        if (ev.type === "item" && ev.item) {
          notify(`🎁 ได้ ${ev.item.icon || ""} ${ev.item.name}`);
        } else if (ev.type === "damage") {
          notify(`⚠️ กับดัก! เสียพลังชีวิต ${ev.amount} HP`, false);
        } else if (ev.type === "knockout") {
          notify("💀 หมดพลัง! ฟื้นสติที่ทางเข้า", false);
        } else if (ev.type === "lore" && ev.text) {
          notify(`💬 ${ev.text.slice(0, 90)}`);
        }
      }
      if (res.room.type === "boss" && !res.state.cleared) {
        setBossQ(null);
        setBossFeedback(null);
        setBossError(null);
        setChosen(null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "เข้าห้องไม่สำเร็จ", false);
    } finally {
      setBusy(null);
    }
  }

  async function handleUseItem(itemKey: string) {
    if (busy) return;
    setBusy(itemKey);
    try {
      const res = await useDungeonItem(sessionId, chapterId, itemKey);
      setDungeon(res);
      onGameState(res.game_state);
      notify(`🧪 ฟื้นพลังชีวิต +${res.healed} HP`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "ใช้ไอเทมไม่สำเร็จ", false);
    } finally {
      setBusy(null);
    }
  }

  const loadBossQuestion = useCallback(async () => {
    setBossLoading(true);
    setBossError(null);
    setBossFeedback(null);
    setChosen(null);
    setBossPhase("idle");
    try {
      const q = await getDungeonBossQuestion(sessionId, chapterId);
      setBossQ(q);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "โหลดคำถามบอสไม่สำเร็จ";
      setBossError(msg);
      notify(msg, false);
    } finally {
      setBossLoading(false);
    }
  }, [sessionId, chapterId, notify]);

  const inBossFight =
    !!state && !!dungeon && state.room === dungeon.boss_room && !state.cleared;

  useEffect(() => {
    if (inBossFight && !bossQ && !bossLoading && !bossFeedback && !bossError) {
      void loadBossQuestion();
    }
  }, [inBossFight, bossQ, bossLoading, bossFeedback, bossError, loadBossQuestion]);

  async function handleAttack(optionIndex: number) {
    if (!bossQ || bossBusy || bossFeedback) return;
    setChosen(optionIndex);
    setBossBusy(true);
    try {
      const res = await attackDungeonBoss(
        sessionId,
        chapterId,
        bossQ.question_id,
        optionIndex
      );
      setBossFeedback(res);
      setBossPhase(res.correct ? "hero_attack" : "enemy_attack");
      onXp(res.xp);
      onGameState(res.game_state);
      if (res.phase_changed) {
        notify(`🔥 บอสเปลี่ยนร่าง: ${res.phase_name ?? `เฟส ${res.phase + 1}`}`);
      }
      if (res.defeated) {
        notify("🏆 ปราบบอสสำเร็จ!");
      }
      if (res.knocked_out) {
        notify("💀 หมดพลัง! ฟื้นสติที่ทางเข้า พร้อมสู้บอสใหม่", false);
        setBossQ(null);
      }
      setDungeon((prev) =>
        prev
          ? {
              ...prev,
              state: {
                ...prev.state,
                room: res.room ?? prev.state.room,
                hp: res.player_hp,
                cleared: res.defeated,
                boss: {
                  phase: res.phase,
                  hp: res.boss_hp,
                  defeated: res.defeated,
                },
              },
            }
          : prev
      );
    } catch (err) {
      // ปลดล็อกตัวเลือกให้ลองใหม่ได้ (ไม่ค้าง disabled)
      setChosen(null);
      setBossPhase("idle");
      notify(err instanceof Error ? err.message : "โจมตีไม่สำเร็จ", false);
    } finally {
      setBossBusy(false);
    }
  }

  // ---- แผนที่ห้อง (เรียงตามตำแหน่งในกราฟ) ----
  const nodes: MapNode[] = useMemo(() => {
    const sorted = [...rooms].sort((a, b) => {
      if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
      return a.pos.x - b.pos.x;
    });
    return sorted.map((room) => {
      const isHere = room.id === state?.room;
      const visited = room.visited || isHere;
      const reachable = (dungeon?.reachable ?? []).includes(room.id);
      const clickable = isHere || reachable;
      return {
        key: room.id,
        title: room.name,
        subtitle: ROOM_LABEL[room.type] ?? room.type,
        icon: ROOM_ICON[room.type] ?? "•",
        state: visited ? "done" : clickable ? "current" : "locked",
        progressText: isHere ? "📍" : visited ? "✓" : clickable ? "▶" : "🔒",
        isBoss: room.type === "boss",
      };
    });
  }, [rooms, state?.room, dungeon?.reachable]);

  const sortedRooms = useMemo(
    () =>
      [...rooms].sort((a, b) => {
        if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
        return a.pos.x - b.pos.x;
      }),
    [rooms]
  );

  if (loading) {
    return (
      <DungeonShell chapter={chapter} onExit={onExit}>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-400">
          <span className="animate-pulse text-4xl">🗺️</span>
          <p className="text-sm">กำลังเปิดประตูดันเจี้ยน...</p>
        </div>
      </DungeonShell>
    );
  }

  if (error || !dungeon || !state) {
    return (
      <DungeonShell chapter={chapter} onExit={onExit}>
        <div className="rounded-2xl border border-rose-800/50 bg-rose-950/30 p-6 text-center">
          <p className="text-3xl">🚪</p>
          <p className="mt-3 text-sm text-rose-200">{error ?? "ไม่พบแผนที่ดันเจี้ยน"}</p>
          <button
            onClick={() => void load()}
            className="mt-4 rounded-lg border border-rose-700 px-4 py-2 text-sm text-rose-200 hover:bg-rose-900/40"
          >
            ลองใหม่
          </button>
        </div>
      </DungeonShell>
    );
  }

  const hpRatio = Math.max(0, Math.min(1, state.hp / Math.max(1, state.max_hp)));
  const bossPhases = currentRoom?.boss?.phases ?? [];
  const bossHp = state.boss?.hp ?? 100;
  const bossPhaseIdx = state.boss?.phase ?? 0;

  return (
    <DungeonShell chapter={chapter} onExit={onExit} dungeonName={dungeon.name}>
      {/* HUD */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex min-w-[150px] flex-1 items-center gap-2">
          <span className="text-rose-300">❤️</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${hpRatio * 100}%` }}
            />
          </div>
          <span className="font-bold tabular-nums text-slate-200">
            {state.hp}/{state.max_hp}
          </span>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 font-semibold text-amber-300">
          🗝️ {state.keys.length}
        </span>
        {state.items.map((key) => {
          const item = dungeon.items[key];
          if (!item) return null;
          return (
            <button
              key={key}
              onClick={() => void handleUseItem(key)}
              disabled={busy !== null}
              title={`ใช้ ${item.name}`}
              className="rounded-full border border-emerald-600/40 bg-emerald-950/40 px-2.5 py-1 font-semibold text-emerald-300 transition hover:border-emerald-400 disabled:opacity-50"
            >
              {item.icon} {item.name} · ใช้
            </button>
          );
        })}
        {state.cleared && (
          <span className="rounded-full border border-emerald-500/50 bg-emerald-900/40 px-2.5 py-1 font-semibold text-emerald-300">
            ✅ ปราบบอสแล้ว
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-5">
        {/* แผนที่ */}
        <div>
          <WorldMapView
            nodes={nodes}
            visualStyle={visualStyle}
            activeKey={state.room}
            onOpen={(i) => {
              const room = sortedRooms[i];
              if (!room || room.id === state.room) return;
              void handleEnter(room.id);
            }}
          />
        </div>

        {/* แผงห้องปัจจุบัน */}
        <aside className="space-y-3">
          {state.cleared ? (
            <div className="rounded-2xl border border-emerald-700/60 bg-emerald-950/30 p-6 text-center">
              <p className="text-5xl">🏆</p>
              <h3 className="mt-3 text-2xl font-black text-emerald-300">ปราบบอสสำเร็จ!</h3>
              <p className="mt-2 text-base text-emerald-200/80">
                คุณเคลียร์ {dungeon.name} แล้ว — กลับไปจบบทเพื่อรับรางวัล
              </p>
              <button
                onClick={onBossCleared}
                className="mt-5 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-base font-bold text-slate-950 transition hover:brightness-110"
              >
                ✅ กลับไปจบบทและรับรางวัล
              </button>
            </div>
          ) : inBossFight ? (
            <div className="rounded-2xl border border-rose-800/60 bg-slate-900/70 p-5">
              <p className="text-sm uppercase tracking-widest text-rose-400/80">
                BOSS · เฟส {bossPhaseIdx + 1}/{Math.max(1, bossPhases.length)}
              </p>
              <h3 className="mt-1 text-2xl font-black text-rose-200">
                {currentRoom?.boss?.name ?? "ผู้พิทักษ์"}
              </h3>
              {bossPhases[bossPhaseIdx]?.name && (
                <p className="text-sm text-rose-300/80">{bossPhases[bossPhaseIdx].name}</p>
              )}

              <div className="mt-3 overflow-hidden rounded-xl border border-slate-800">
                <BattleStage
                  environment="dungeon"
                  seed={currentRoom?.boss?.name ?? chapter.title}
                  style={visualStyle}
                  enemyName={currentRoom?.boss?.name ?? "ผู้พิทักษ์"}
                  enemyKind="boss"
                  enemyHpRatio={bossHp / 100}
                  playerHpRatio={hpRatio}
                  phase={bossPhase}
                  defeated={state.cleared}
                />
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-rose-300">👑</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-orange-400 transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, bossHp))}%` }}
                  />
                </div>
                <span className="tabular-nums text-slate-300">{bossHp}/100</span>
              </div>

              {bossFeedback ? (
                <div className="mt-3 space-y-2">
                  <p
                    className={`rounded-lg px-3 py-2.5 text-base font-semibold ${
                      bossFeedback.correct
                        ? "bg-emerald-950/60 text-emerald-300"
                        : "bg-rose-950/60 text-rose-300"
                    }`}
                  >
                    {bossFeedback.correct
                      ? `⚔️ ถูกต้อง! สร้างความเสียหาย ${bossFeedback.damage}`
                      : `💥 ผิด! คุณเสียพลังชีวิต ${bossFeedback.player_damage}`}
                  </p>
                  {bossFeedback.explanation && (
                    <p className="text-sm leading-relaxed text-slate-400">
                      {bossFeedback.explanation}
                    </p>
                  )}
                  {bossFeedback.defeated ? (
                    <button
                      onClick={onBossCleared}
                      className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 font-black text-slate-950 transition hover:brightness-110"
                    >
                      🏆 รับชัยชนะ — กลับไปจบบท
                    </button>
                  ) : (
                    <button
                      onClick={() => void loadBossQuestion()}
                      disabled={bossLoading}
                      className="w-full rounded-xl bg-indigo-600 py-3 text-base font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {bossLoading ? "กำลังเรียกคำถาม..." : "คำถามถัดไป →"}
                    </button>
                  )}
                </div>
              ) : bossQ ? (
                <div className="mt-3">
                  <p className="text-base font-semibold leading-relaxed text-slate-100">
                    {bossQ.question}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {bossQ.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => void handleAttack(i)}
                        disabled={bossBusy || chosen !== null}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left text-base transition ${
                          chosen === i
                            ? "border-indigo-400 bg-indigo-950/60 text-indigo-100"
                            : "border-slate-700 bg-slate-950/60 text-slate-200 hover:border-indigo-500"
                        } disabled:opacity-60`}
                      >
                        {String.fromCharCode(65 + i)}. {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 animate-pulse text-sm text-slate-400">
                  {bossLoading ? "กำลังเรียกคำถาม..." : "บอสกำลังรอการโจมตี..."}
                </p>
              )}

              {bossError && !bossQ && (
                <div className="mt-3 rounded-lg border border-rose-800/50 bg-rose-950/40 p-2 text-center">
                  <p className="text-xs text-rose-200">{bossError}</p>
                  <button
                    onClick={() => void loadBossQuestion()}
                    className="mt-2 rounded-lg border border-rose-700 px-3 py-1 text-xs text-rose-200 hover:bg-rose-900/40"
                  >
                    ลองใหม่
                  </button>
                </div>
              )}
            </div>
          ) : currentRoom ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-sm uppercase tracking-widest text-slate-500">
                {ROOM_LABEL[currentRoom.type]} · {ROOM_ICON[currentRoom.type]}
              </p>
              <h3 className="mt-1 text-2xl font-bold text-slate-100">{currentRoom.name}</h3>
              <p className="mt-2 text-base leading-relaxed text-slate-400">{currentRoom.desc}</p>

              {currentRoom.reward && (
                <p className="mt-2 rounded-lg bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
                  🎁 {currentRoom.reward.icon} {currentRoom.reward.name}
                </p>
              )}

              {currentRoom.type === "quiz" && pendingQuizIds.length > 0 ? (
                <button
                  onClick={() => onEnterQuizRoom(currentRoom)}
                  className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-base font-bold text-white transition hover:from-indigo-500 hover:to-violet-500"
                >
                  ❓ ตอบคำถามในห้องนี้ ({pendingQuizIds.length} ข้อ)
                </button>
              ) : (
                <div className="mt-4 space-y-2">
                  {currentRoom.doors.map((door) => {
                    const target = rooms.find((r) => r.id === door.to);
                    return (
                      <button
                        key={`${door.to}-${door.label}`}
                        onClick={() => void handleEnter(door.to)}
                        disabled={door.locked || busy !== null}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-base transition ${
                          door.locked
                            ? "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-500"
                            : "border-slate-700 bg-slate-950/60 text-slate-200 hover:border-indigo-500"
                        } disabled:opacity-60`}
                      >
                        <span>
                          {door.locked ? "🔒" : ROOM_ICON[target?.type ?? "npc"]} {door.label}
                        </span>
                        <span className="text-sm text-slate-500">
                          {door.locked ? door.requires_name ?? "ต้องมีกุญแจ" : target?.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentRoom.type === "quiz" && pendingQuizIds.length === 0 && (
                <p className="mt-3 text-sm text-emerald-400/80">
                  ✅ ตอบคำถามห้องนี้ครบแล้ว — เลือกประตูต่อไปได้
                </p>
              )}
            </div>
          ) : null}

          <p className="text-center text-xs leading-relaxed text-slate-600">
            ประตูที่มีกุญแจต้องสำรวจห้องสมบัติก่อน · ห้องโบนัสไม่บังคับ แต่ให้ไอเทมช่วยสู้บอส
          </p>
        </aside>
      </div>
    </DungeonShell>
  );
}

function DungeonShell({
  chapter,
  dungeonName,
  onExit,
  children,
}: {
  chapter: ChapterView;
  dungeonName?: string | null;
  onExit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-40 border-b border-slate-800/70 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3">
          <button
            onClick={onExit}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-500 hover:text-white"
          >
            ← <span className="hidden sm:inline">แผนที่โลก</span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight">
              🗺️ {dungeonName || chapter.dungeon?.name || chapter.title}
            </p>
            <p className="truncate text-xs text-slate-500">{chapter.title}</p>
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-[1440px] px-3 py-5 sm:px-4">{children}</main>
    </div>
  );
}
