"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { PixelSprite, PixelScene, BattleStage, type BattlePhase } from "@/components/PixelArt";
import BasePanel from "@/components/game/BasePanel";
import DialogueBox, { type DialogueNpc } from "@/components/game/DialogueBox";
import WorldMapView, { type MapNode } from "@/components/game/WorldMapView";
import { useAuthToken } from "@/lib/useAuthToken";
import {
  getCourseStructure,
  startSession,
  submitAnswer,
  completeChapter,
  finishSession,
  reviveSession,
  requestHint,
  RESOURCE_META,
  type CourseStructure,
  type ChapterView,
  type AnswerResult,
  type CheckpointResult,
  type GameResult,
  type GameState,
} from "@/lib/api";

type Screen = "map" | "chapter" | "result";

interface Toast {
  id: number;
  msg: string;
  ok: boolean;
}

let toastId = 0;

export default function CoursePlayPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">กำลังโหลด...</div>}>
      <CoursePlayInner />
    </Suspense>
  );
}

function CoursePlayInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const courseId = Number(params.id);
  // Guest mode: เปิดจาก public link — ไม่ต้อง login (progress เก็บผ่าน X-Player-Key)
  const isGuest = searchParams.get("guest") === "1";
  const authToken = useAuthToken();
  const token = isGuest ? "guest" : authToken;

  const [data, setData] = useState<CourseStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Session state — XP/คำตอบ/ทรัพยากร ทั้งหมดมาจาก Backend เท่านั้น
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [xp, setXp] = useState(0);
  const [completedChapters, setCompletedChapters] = useState<number[]>([]);
  const [answeredMap, setAnsweredMap] = useState<Record<string, boolean>>({});

  // Game systems state (server-owned)
  const [gs, setGs] = useState<GameState>({
    combo: 0, best_combo: 0, deaths: 0,
    resources: { gold: 0, wood: 0, stone: 0, crystal: 0, knowledge: 0 },
    buildings: [],
  });

  const [screen, setScreen] = useState<Screen>("map");
  const [mapTab, setMapTab] = useState<"world" | "base">("world");
  const [activeChapter, setActiveChapter] = useState<ChapterView | null>(null);
  const [viewMode, setViewMode] = useState<"learn" | "play">("learn");

  // Per-question state
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [results, setResults] = useState<Record<number, AnswerResult>>({});
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [qIndex, setQIndex] = useState(0); // การ์ดคำถามแสดงทีละใบ
  const [hints, setHints] = useState<Record<number, number[]>>({});
  const [hintLoading, setHintLoading] = useState<number | null>(null);

  // Combat state
  const [enemyHp, setEnemyHp] = useState(0);
  const [enemyShake, setEnemyShake] = useState(false);
  const [enemyDefeatAnim, setEnemyDefeatAnim] = useState(false);
  const [floaty, setFloaty] = useState<{ id: number; text: string; color: string } | null>(null);
  const [playerHit, setPlayerHit] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [battlePhase, setBattlePhase] = useState<BattlePhase>("idle");
  const qCardRef = useRef<HTMLDivElement>(null);

  // Checkpoint / Result / Restart
  const [checkpoint, setCheckpoint] = useState<CheckpointResult | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [restarting, setRestarting] = useState(false);

  // RPG dialogue + toasts
  const [dialogue, setDialogue] = useState<DialogueNpc | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(msg: string, ok = true) {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-3), { id, msg, ok }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  }

  const visualStyle =
    data?.world && "visual_style" in (data.world || {})
      ? String((data.world as { visual_style?: string }).visual_style)
      : "pixel_art";

  useEffect(() => {
    if (!courseId || token === null) return;

    Promise.all([getCourseStructure(courseId), startSession(courseId)])
      .then(([structure, session]) => {
        setData(structure);
        hydrateSession(session);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดเกมไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [courseId, token]);

  function hydrateSession(session: {
    session_id: number;
    xp: number;
    answered: Record<
      string,
      {
        answer: number | null;
        correct: boolean;
        correct_answer_index: number | null;
        explanation: string | null;
        source_reference: string | null;
      }
    >;
    completed_chapters: number[];
    game_state?: GameState;
  }) {
    setSessionId(session.session_id);
    setXp(session.xp || 0);
    setCompletedChapters(session.completed_chapters || []);
    if (session.game_state) setGs(session.game_state);

    const answered: Record<string, boolean> = {};
    const hydratedResults: Record<number, AnswerResult> = {};
    for (const [qidStr, rec] of Object.entries(session.answered || {})) {
      answered[qidStr] = rec.correct;
      hydratedResults[Number(qidStr)] = {
        already_answered: true,
        correct: rec.correct,
        correct_answer_index: rec.correct_answer_index,
        explanation: rec.explanation ?? undefined,
        source_reference: rec.source_reference,
        xp_awarded: 0,
        total_xp: session.xp || 0,
      };
    }
    setAnsweredMap(answered);
    setResults(hydratedResults);
  }

  // ---- Modes ----
  const modes = useMemo(() => data?.game_modes ?? [], [data]);
  const hasCombat = modes.includes("turn_based");
  const hasBase = modes.includes("base_building");
  const hasRpg = modes.includes("rpg_lore");

  // refs สำหรับ combat (อ่านค่าล่าสุดใน async callback ได้)
  const enemyHpRef = useRef(0);
  const enemyMaxHpRef = useRef(1);
  const enemyNameRef = useRef("");
  const defeatLockRef = useRef(false);
  useEffect(() => {
    enemyHpRef.current = enemyHp;
  }, [enemyHp]);

  // ---- Derived ----
  const levels = useMemo(() => data?.gamification.levels ?? [], [data]);
  const currentLevel = useMemo(() => {
    let lv = { level: 1, title: "Novice", xp_required: 0 };
    for (const l of levels) if (xp >= l.xp_required) lv = l;
    return lv;
  }, [levels, xp]);

  const progressPercent =
    data && data.chapters.length > 0
      ? Math.round((completedChapters.length / data.chapters.length) * 100)
      : 0;

  const world = (data?.world ?? {}) as CourseStructure["world"];
  const enemiesList = Array.isArray(world?.enemies) ? world.enemies : [];
  const bossesList = Array.isArray(world?.bosses) ? world.bosses : [];
  const npcsList = Array.isArray(world?.npcs) ? world.npcs : [];

  function chapterEnemy(chapterIndex: number) {
    const isFinal = data && chapterIndex === data.chapters.length - 1;
    if (isFinal && bossesList.length > 0) {
      const b = bossesList[Math.min(bossesList.length - 1, Math.floor(chapterIndex / Math.max(1, data!.chapters.length - bossesList.length)))];
      return { name: b.name, isBoss: true, maxHp: Math.min(b.total_hp || 140, 200) };
    }
    if (enemiesList.length > 0) {
      const e = enemiesList[chapterIndex % enemiesList.length];
      return { name: e.name, isBoss: false, maxHp: 55 + chapterIndex * 15 };
    }
    return { name: `มอนสเตอร์ ${chapterIndex + 1}`, isBoss: false, maxHp: 55 + chapterIndex * 15 };
  }

  // ---- Actions ----

  function openChapter(chapter: ChapterView) {
    setActiveChapter(chapter);
    setViewMode(completedChapters.includes(chapter.chapter_id) ? "play" : "learn");
    setSelected({});
    setCheckpoint(null);
    setScreen("chapter");

    // เริ่มที่ข้อแรกที่ยังไม่ได้ตอบ (resume กลาง chapter ได้)
    const firstUn = chapter.quiz_questions.findIndex(
      (qq) => answeredMap[String(qq.id)] === undefined
    );
    setQIndex(firstUn === -1 ? chapter.quiz_questions.length : firstUn);

    // Init enemy สำหรับ combat
    const idx = data!.chapters.indexOf(chapter);
    const enemy = chapterEnemy(idx);
    setEnemyHp(enemy.maxHp);
    enemyMaxHpRef.current = enemy.maxHp;
    enemyNameRef.current = enemy.name;
    defeatLockRef.current = false;
    setEnemyDefeatAnim(false);

    // RPG dialogue เมื่อเข้า chapter (ยกเว้นเคยปิดแล้วใน run นี้)
    if (hasRpg && npcsList.length > 0) {
      const npc = npcsList[idx % npcsList.length];
      setDialogue({ name: npc.name, role: npc.role, dialogue: npc.dialogue });
    }
  }

  async function handleRestart() {
    if (!courseId || restarting) return;
    setRestarting(true);
    try {
      const fresh = await startSession(courseId, { fresh: true });
      setSelected({});
      setResults({});
      setHints({});
      setCheckpoint(null);
      setGameResult(null);
      setActiveChapter(null);
      setGameOver(false);
      setScreen("map");
      hydrateSession(fresh);
      pushToast("🔄 เริ่มการผจญภัยใหม่แล้ว!");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "เริ่มใหม่ไม่สำเร็จ", false);
    } finally {
      setRestarting(false);
    }
  }

  const handleAnswer = useCallback(
    async function handleAnswer(questionId: number, answerIndex: number) {
      if (!sessionId || results[questionId]) return;
      setSubmittingId(questionId);
      try {
        const result = await submitAnswer(sessionId, questionId, answerIndex);
        setResults((prev) => ({ ...prev, [questionId]: result }));
        setAnsweredMap((prev) => ({ ...prev, [String(questionId)]: result.correct }));
        setXp(result.total_xp);
        if (result.game_state) setGs(result.game_state);

        // ---- Resource rewards toast ----
        const rw = result.resources_awarded;
        if (rw && Object.values(rw).some((v) => (v ?? 0) > 0)) {
          const parts = Object.entries(rw)
            .filter(([, v]) => (v ?? 0) > 0)
            .map(([k, v]) => `${RESOURCE_META[k as keyof typeof RESOURCE_META].icon}+${v}`);
          pushToast(`✨ ${parts.join(" ")}`);
        }

        if (hasCombat) {
          if (result.correct) {
            // ---- Hero lunge + attack ----
            const combo = result.game_state?.combo ?? 0;
            const mult = combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
            const dmg = Math.round(22 * mult);
            const next = Math.max(0, enemyHpRef.current - dmg);

            setBattlePhase("hero_attack");
            setTimeout(() => setBattlePhase("idle"), 600);
            setEnemyShake(true);
            setTimeout(() => setEnemyShake(false), 400);
            setFloaty({
              id: Date.now(),
              text: mult > 1 ? `-${dmg} ×${mult}!` : `-${dmg}`,
              color: "#fbbf24",
            });
            setTimeout(() => setFloaty(null), 900);

            // HP ลดตาม timing ของการพุ่งชน (~55% ของ animation)
            setTimeout(() => setEnemyHp(next), 300);

            if (next <= 0 && !defeatLockRef.current) {
              defeatLockRef.current = true;
              setEnemyDefeatAnim(true);
              pushToast(`💥 ${enemyNameRef.current} ถูกกำจัด! +25 XP bonus`);
              setTimeout(() => {
                setEnemyDefeatAnim(false);
                setEnemyHp(enemyMaxHpRef.current || 1);
                defeatLockRef.current = false;
                pushToast("👾 ศัตรูตัวใหม่ปรากฏ!");
              }, 850);
            }
          } else if ((result.enemy_damage ?? 0) > 0) {
            // ---- Enemy counterattack ----
            setBattlePhase("enemy_attack");
            setTimeout(() => setBattlePhase("idle"), 600);
            setTimeout(() => {
              setPlayerHit(true);
              setTimeout(() => setPlayerHit(false), 400);
            }, 250);
            setFloaty({
              id: Date.now(),
              text: `-${result.enemy_damage}`,
              color: "#f87171",
            });
            setTimeout(() => setFloaty(null), 900);
          }
        }

        if (result.defeated) setGameOver(true);
      } catch (err) {
        pushToast(err instanceof Error ? err.message : "ส่งคำตอบไม่สำเร็จ", false);
      } finally {
        setSubmittingId(null);
      }
    },
    [sessionId, results, hasCombat]
  );

  async function handleRevive() {
    if (!sessionId) return;
    try {
      const res = await reviveSession(sessionId);
      setGs(res.game_state);
      setGameOver(false);
      pushToast(res.message);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "ฟื้นไม่สำเร็จ", false);
    }
  }

  async function handleHint(questionId: number) {
    if (!sessionId || hintLoading !== null) return;
    setHintLoading(questionId);
    try {
      const res = await requestHint(sessionId, questionId);
      setHints((prev) => ({
        ...prev,
        [questionId]: [...(prev[questionId] ?? []), res.eliminated_option],
      }));
      if (res.game_state) setGs(res.game_state);
      pushToast(res.message);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "ใช้ Hint ไม่ได้", false);
    } finally {
      setHintLoading(null);
    }
  }

  function goNextQ() {
    const qs = activeChapter?.quiz_questions ?? [];
    const q = qs[Math.min(qIndex, qs.length - 1)];
    if (q) {
      setSelected((prev) => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
    }
    setQIndex((i) => Math.min(i + 1, qs.length));
    // เลื่อนแค่การ์ดคำถามเข้าจอ — ไม่ดันฉากเกมหลุด (desktop เห็นพร้อมกันอยู่แล้ว)
    requestAnimationFrame(() => {
      qCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function handleCompleteChapter() {
    if (!sessionId || !activeChapter) return;
    try {
      const cp = await completeChapter(sessionId, activeChapter.chapter_id);
      setCheckpoint(cp);
      setXp(cp.total_xp);
      setCompletedChapters(cp.completed_chapters);
      if (cp.game_state) setGs(cp.game_state);
      const rw = cp.chapter_rewards;
      if (rw && Object.values(rw).some((v) => (v ?? 0) > 0)) {
        const parts = Object.entries(rw)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([k, v]) => `${RESOURCE_META[k as keyof typeof RESOURCE_META].icon}+${v}`);
        pushToast(`🏁 Chapter clear! ${parts.join(" ")}`);
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "บันทึก checkpoint ไม่สำเร็จ", false);
    }
  }

  async function handleFinishGame() {
    if (!sessionId) return;
    try {
      const result = await finishSession(sessionId);
      setGameResult(result);
      setScreen("result");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "สรุปผลไม่สำเร็จ", false);
    }
  }

  function isChapterUnlocked(chapter: ChapterView, index: number): boolean {
    if (index === 0) return true;
    return completedChapters.includes(data!.chapters[index - 1].chapter_id);
  }

  // ---- Render guards ----
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <span className="animate-pulse">🌍 กำลังโหลดโลกของคุณ...</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-rose-400">
        <p>{error ?? "ไม่พบข้อมูล"}</p>
        <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
          ← กลับ Dashboard
        </Link>
      </div>
    );
  }

  const zones = Array.isArray(world?.zones) ? world.zones : [];

  const hudChips = (
    <>
      {hasCombat && (
        <div className={`rounded-full border px-4 py-1.5 ${
          (gs.hp ?? 0) / Math.max(1, gs.max_hp ?? 1) > 0.3
            ? "border-rose-500/30 bg-rose-950/40"
            : "animate-pulse border-rose-500 bg-rose-900/60"
        }`}>
          <span className="font-bold text-rose-300">
            ❤️ {gs.hp ?? 0}/{gs.max_hp ?? 100}
          </span>
        </div>
      )}
      {(gs.combo ?? 0) >= 2 && (
        <div className="eq-pop rounded-full border border-orange-500/40 bg-orange-950/40 px-3 py-1.5">
          <span className="text-sm font-bold text-orange-300">🔥 Combo x{gs.combo}</span>
        </div>
      )}
      {hasBase &&
        (["gold", "wood", "stone", "crystal"] as const).map((k) => (
          <div key={k} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm">
            <span className="font-semibold text-slate-200">
              {RESOURCE_META[k].icon} {gs.resources[k]}
            </span>
          </div>
        ))}
      {!hasCombat && !hasBase && (
        <div className="rounded-full border border-amber-500/30 bg-amber-950/40 px-4 py-1.5">
          <span className="font-bold text-amber-400">🔥 XP {xp.toLocaleString()}</span>
        </div>
      )}
    </>
  );

  // =====================================================================
  // SCREEN: WORLD MAP
  // =====================================================================
  if (screen === "map") {
    return (
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        {!isGuest && <SiteHeader />}

        {/* Toasts */}
        <div className="pointer-events-none fixed right-4 top-20 z-[70] space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`eq-pop rounded-xl border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur ${
                t.ok
                  ? "border-emerald-600/50 bg-emerald-950/80 text-emerald-200"
                  : "border-rose-600/50 bg-rose-950/80 text-rose-200"
              }`}
            >
              {t.msg}
            </div>
          ))}
        </div>

        {/* HUD */}
        <div className="border-b border-slate-800/60 bg-slate-900/50">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-b from-slate-900 to-slate-950 p-1 shadow-lg shadow-indigo-950/40">
                <PixelSprite kind="hero" seed="player-hero" style={visualStyle} size={44} floating />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-indigo-400">World</p>
                <h1 className="text-xl font-bold sm:text-2xl">
                  🌍 {world.world_name || data.course_title}
                </h1>
                <p className="text-xs text-slate-500">
                  ⭐ Lv.{currentLevel.level} · 🔥 XP {xp.toLocaleString()}
                  {modes.length > 0 && ` · ${modes.length} Game Mode${modes.length > 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">{hudChips}</div>
          </div>
          <div className="mx-auto max-w-5xl px-6 pb-4">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Progress</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/60">
                <div
                  className="relative h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-500 transition-all duration-700"
                  style={{ width: `${progressPercent}%` }}
                >
                  {progressPercent > 0 && (
                    <span className="eq-progress-shimmer absolute inset-0 rounded-full" />
                  )}
                </div>
              </div>
              <span className="font-semibold text-slate-300">{progressPercent}%</span>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
          {/* Tabs */}
          {hasBase && (
            <div className="mb-6 inline-flex gap-1 rounded-full bg-slate-900 p-1">
              <button
                onClick={() => setMapTab("world")}
                className={`rounded-full px-6 py-2 text-sm font-medium transition ${
                  mapTab === "world" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🗺️ World Map
              </button>
              <button
                onClick={() => setMapTab("base")}
                className={`rounded-full px-6 py-2 text-sm font-medium transition ${
                  mapTab === "base" ? "bg-emerald-500 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🏰 Base ({gs.buildings.length}/7)
              </button>
            </div>
          )}

          {mapTab === "base" && hasBase && sessionId ? (
            <BasePanel
              sessionId={sessionId}
              gameState={gs}
              totalChapters={data.chapters.length}
              completedCount={completedChapters.length}
              visualStyle={visualStyle}
              onChanged={setGs}
              notify={(m, ok) => pushToast(m, ok)}
              onXpUpdate={(totalXp) => setXp(totalXp)}
            />
          ) : (
            <>
              {world.intro_story && (
                <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                  <p className="whitespace-pre-line leading-relaxed text-slate-300">{world.intro_story}</p>
                </div>
              )}

              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-300">🗺️ WORLD MAP</h2>
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-50"
                  >
                    {restarting ? "..." : "🔄 เริ่มภารกิจใหม่"}
                  </button>
                </div>

                {(() => {
                  const entries = (
                    zones.length > 0
                      ? zones.map((zone) => ({
                          zone,
                          chapter:
                            zone.chapter_id != null
                              ? data.chapters.find((c) => c.chapter_id === zone.chapter_id)
                              : undefined,
                        }))
                      : data.chapters.map((c) => ({ zone: null, chapter: c }))
                  ).filter(
                    (e): e is { zone: typeof e.zone; chapter: ChapterView } =>
                      e.chapter !== undefined
                  );
                  const envIcon = (env?: string) => {
                    const s = (env || "").toLowerCase();
                    if (s.includes("village")) return "🏠";
                    if (s.includes("forest")) return "🌲";
                    if (s.includes("mountain")) return "⛰️";
                    if (s.includes("castle")) return "🏰";
                    if (s.includes("dungeon") || s.includes("cave")) return "🔥";
                    if (s.includes("city")) return "🏙️";
                    if (s.includes("laboratory") || s.includes("lab")) return "🧪";
                    return "🗺️";
                  };
                  const nodes: MapNode[] = entries.map(({ zone, chapter }) => {
                    const idx = data.chapters.indexOf(chapter);
                    const unlocked = isChapterUnlocked(chapter, idx);
                    const done = completedChapters.includes(chapter.chapter_id);
                    const qTotal = chapter.quiz_questions.length;
                    const qDone = chapter.quiz_questions.filter(
                      (q) => answeredMap[String(q.id)] !== undefined
                    ).length;
                    const enemy = chapterEnemy(idx);
                    const isBoss = enemy.isBoss;
                    return {
                      key: chapter.chapter_id,
                      title: zone?.name || chapter.title,
                      subtitle: `${chapter.title} · ${qTotal} ภารกิจ${
                        hasCombat ? ` · ${isBoss ? "BOSS " : ""}${enemy.name} ${enemy.maxHp} HP` : ""
                      }`,
                      icon: isBoss ? "👑" : envIcon(zone?.environment),
                      state: done ? "done" : unlocked ? "current" : "locked",
                      progressText: !unlocked ? "🔒" : qDone > 0 ? `${qDone}/${qTotal}` : "▶",
                      isBoss,
                    };
                  });
                  return (
                    <WorldMapView
                      nodes={nodes}
                      visualStyle={visualStyle}
                      onOpen={(i) => {
                        const ch = entries[i]?.chapter;
                        if (ch) openChapter(ch);
                      }}
                    />
                  );
                })()}
              </section>

              {/* Bosses */}
              {bossesList.length > 0 && (
                <section className="mt-10">
                  <h2 className="mb-4 text-lg font-bold text-slate-300">👹 BOSSES</h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {bossesList.map((boss) => (
                      <div key={boss.name} className="flex gap-4 rounded-xl border border-rose-900/40 bg-rose-950/20 p-4">
                        <PixelSprite kind="boss" seed={boss.name} style={visualStyle} size={80} />
                        <div className="min-w-0">
                          <p className="font-bold text-rose-300">{boss.name}</p>
                          <p className="text-xs uppercase tracking-wider text-rose-400/70">{boss.title}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {boss.phases.slice(0, 4).map((phase, i) => (
                              <span key={i} className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                                P{i + 1}: {phase.length > 22 ? phase.slice(0, 22) + "…" : phase}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Enemies */}
              {enemiesList.length > 0 && (
                <section className="mt-10">
                  <h2 className="mb-4 text-lg font-bold text-slate-300">👾 MONSTERS</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {enemiesList.map((enemy) => (
                      <div key={enemy.name} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-center transition hover:border-rose-800/60">
                        <PixelSprite kind="enemy" seed={enemy.name} style={visualStyle} size={56} />
                        <p className="mt-2 truncate text-sm font-semibold text-slate-200">{enemy.name}</p>
                        <p className="truncate text-[11px] text-slate-500">HP {enemy.hp}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* NPCs */}
              {npcsList.length > 0 && (
                <section className="mt-10">
                  <h2 className="mb-4 text-lg font-bold text-slate-300">🧑‍🏫 NPCS</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {npcsList.map((npc) => (
                      <div key={npc.name} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                        <PixelSprite kind="npc" seed={npc.name} style={visualStyle} size={48} />
                        <div className="min-w-0">
                          <p className="truncate font-bold text-slate-200">{npc.name}</p>
                          <p className="truncate text-xs text-indigo-400">{npc.role}</p>
                          <p className="mt-1 line-clamp-2 text-sm italic text-slate-400">&ldquo;{npc.dialogue}&rdquo;</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {progressPercent === 100 && (
                <div className="mt-12 text-center">
                  <button
                    onClick={handleFinishGame}
                    className="rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 px-10 py-4 text-lg font-bold shadow-lg shadow-amber-600/30 transition hover:from-amber-400 hover:to-rose-400"
                  >
                    🏆 รับผลการเรียนรู้ (Learning Report)
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    );
  }

  // =====================================================================
  // SCREEN: RESULT
  // =====================================================================
  if (screen === "result" && gameResult) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        {!isGuest && <SiteHeader />}
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
          <div className="rounded-3xl border border-amber-800/40 bg-gradient-to-b from-amber-950/30 to-slate-900/60 p-8 text-center">
            <div className="flex justify-center">
              <PixelSprite kind="hero" seed="player-hero" style={visualStyle} size={72} />
            </div>
            <h1 className="mt-3 text-3xl font-bold">QUEST COMPLETE!</h1>
            <p className="mt-1 text-slate-400">{world.world_name || data.course_title}</p>

            <div className="mt-8 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-950/60 p-4">
                <p className="text-2xl font-bold text-amber-400">{gameResult.total_xp}</p>
                <p className="text-xs text-slate-400">XP รวม</p>
              </div>
              <div className="rounded-xl bg-slate-950/60 p-4">
                <p className="text-2xl font-bold text-emerald-400">{gameResult.accuracy_percent}%</p>
                <p className="text-xs text-slate-400">ความแม่นยำ</p>
              </div>
              <div className="rounded-xl bg-slate-950/60 p-4">
                <p className="text-2xl font-bold text-indigo-400">{gameResult.learning_coverage_percent}%</p>
                <p className="text-xs text-slate-400">Coverage</p>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <h2 className="font-bold text-slate-300">📊 Learning Coverage</h2>
            {gameResult.per_chapter.map((row) => (
              <div key={row.chapter}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">{row.chapter}</span>
                  <span className={row.mastery_percent >= 80 ? "text-emerald-400" : row.mastery_percent >= 50 ? "text-amber-400" : "text-rose-400"}>
                    Mastery {row.mastery_percent}%
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      row.mastery_percent >= 80 ? "bg-emerald-500" : row.mastery_percent >= 50 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${row.mastery_percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {gameResult.needs_practice.length > 0 && (
            <div className="mt-6 rounded-xl border border-amber-900/50 bg-amber-950/25 p-5">
              <h3 className="font-bold text-amber-300">🎯 Needs Practice</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-200/90">
                {gameResult.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/dashboard" className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold transition hover:bg-indigo-500">
              ← กลับ Dashboard
            </Link>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="rounded-xl border border-emerald-700 px-6 py-3 font-semibold text-emerald-300 transition hover:bg-emerald-950/40 disabled:opacity-50"
            >
              🔄 เล่นอีกรอบ
            </button>
          </div>
        </main>
      </div>
    );
  }

  // =====================================================================
  // SCREEN: CHAPTER
  // =====================================================================
  const chapter = activeChapter!;
  const chapterIdx = data.chapters.indexOf(chapter);
  const enemy = chapterEnemy(chapterIdx);
  const comboMult = (gs.combo ?? 0) >= 5 ? 3 : (gs.combo ?? 0) >= 3 ? 2 : 1;
  const chapterQuestionsAnswered = chapter.quiz_questions.every(
    (q) => results[q.id] || answeredMap[String(q.id)] !== undefined
  );

  return (
    <div className={`flex min-h-screen flex-col bg-slate-950 text-slate-100 ${playerHit ? "eq-shake" : ""}`}>
        {!isGuest && <SiteHeader />}

      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-20 z-[70] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`eq-pop rounded-xl border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur ${
              t.ok ? "border-emerald-600/50 bg-emerald-950/80 text-emerald-200" : "border-rose-600/50 bg-rose-950/80 text-rose-200"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* Slim sticky HUD — แถบเดียวจบ: กลับแผนที่ · ชื่อด่าน · HP/XP/combo */}
      <div className={`${isGuest ? "top-0" : "top-16"} sticky z-40 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur`}>
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-sm lg:px-6">
          <button
            onClick={() => setScreen("map")}
            aria-label="กลับแผนที่"
            className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-300 transition hover:border-indigo-500 hover:text-white"
          >
            ← <span className="hidden sm:inline">Map</span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold leading-tight">{chapter.title}</p>
            {viewMode === "play" && (
              <p className="text-[11px] leading-tight text-slate-500">
                ข้อ {Math.min(qIndex + 1, chapter.quiz_questions.length)}/{chapter.quiz_questions.length}
                {hasCombat && <> · 👾 {enemy.isBoss ? "👑 " : ""}{enemy.name} {Math.max(0, enemyHp)}/{enemy.maxHp}</>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {hasCombat && (
              <span className="rounded-full border border-rose-500/30 bg-rose-950/40 px-2.5 py-1 text-xs font-bold text-rose-300">
                ❤️ {gs.hp ?? 0}/{gs.max_hp ?? 100}
              </span>
            )}
            {(gs.combo ?? 0) >= 2 && (
              <span className="eq-pop rounded-full border border-orange-500/40 bg-orange-950/40 px-2.5 py-1 text-xs font-bold text-orange-300">
                🔥x{gs.combo}
              </span>
            )}
            {hasBase && (
              <span className="hidden text-xs text-slate-300 md:inline">
                💰{gs.resources.gold} 🪵{gs.resources.wood} 🪨{gs.resources.stone} 💎{gs.resources.crystal}
              </span>
            )}
            <span className="rounded-full border border-amber-500/30 bg-amber-950/40 px-2.5 py-1 text-xs font-bold text-amber-400">
              🔥 {xp.toLocaleString()}
            </span>
          </div>
        </div>
        {/* เส้น progress บางๆ ใต้ HUD */}
        {viewMode === "play" && (
          <div className="h-0.5 bg-slate-800/60">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${(chapter.quiz_questions.filter((q) => answeredMap[String(q.id)] !== undefined).length / Math.max(1, chapter.quiz_questions.length)) * 100}%` }}
            />
          </div>
        )}
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 lg:px-6">
        <div className="grid items-start gap-5 lg:grid-cols-[440px_minmax(0,1fr)] xl:grid-cols-[560px_minmax(0,1fr)]">
          {/* ===== LEFT: มุมมองเกม (PC: sticky ค้างซ้าย · มือถือ: อยู่บนสุดย่อขนาด) ===== */}
          <aside className="lg:sticky lg:top-32">
            <div className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl shadow-slate-950/60 ${enemyShake ? "eq-shake" : ""}`}>
              {hasCombat && viewMode === "play" ? (
                <>
                  <BattleStage
                    environment={
                      zones.find((z) => z.chapter_id === chapter.chapter_id)?.environment ||
                      "village"
                    }
                    seed={chapter.title}
                    style={visualStyle}
                    enemyName={enemy.name}
                    enemyKind={enemy.isBoss ? "boss" : "enemy"}
                    enemyHpRatio={Math.max(0, enemyHp) / Math.max(1, enemy.maxHp)}
                    playerHpRatio={(gs.hp ?? 0) / Math.max(1, gs.max_hp ?? 100)}
                    phase={battlePhase}
                    defeated={enemyDefeatAnim}
                  />
                  {floaty && (
                    <span
                      key={floaty.id}
                      className="eq-float eq-dmg pointer-events-none absolute right-[22%] top-[28%] z-10 text-3xl"
                      style={{ color: floaty.color }}
                    >
                      {floaty.text}
                    </span>
                  )}
                </>
              ) : (
                <PixelScene
                  environment={zones.find((z) => z.chapter_id === chapter.chapter_id)?.environment || "village"}
                  seed={chapter.title}
                  style={visualStyle}
                  animated
                />
              )}
            </div>
            {/* สถานะด่านใต้ฉาก — บรรทัดเดียว ไม่ซ้ำ HUD */}
            <p className="mt-2 truncate text-center text-xs text-slate-500">
              {viewMode === "play"
                ? hasCombat
                  ? `⚔️ ตอบถูก = โจมตี${comboMult > 1 ? ` ×${comboMult}` : ""} · ตอบผิด = โดนสวน`
                  : `📖 ${chapter.quiz_questions.length} ภารกิจในโซนนี้`
                : `🎯 ${chapter.lesson?.objective ?? ""}`}
            </p>
          </aside>

          {/* ===== RIGHT: โฟลว์เรียน/เล่น ===== */}
          <section ref={qCardRef} className="min-w-0 scroll-mt-32">
            <div className="inline-flex gap-1 rounded-full bg-slate-900 p-1">
          <button
            onClick={() => setViewMode("learn")}
            className={`rounded-full px-5 py-1.5 text-sm transition ${
              viewMode === "learn" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            📖 เรียนรู้
          </button>
          <button
            onClick={() => setViewMode("play")}
            className={`rounded-full px-5 py-1.5 text-sm transition ${
              viewMode === "play" ? "bg-emerald-500 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            ⚔️ ภารกิจ ({chapter.quiz_questions.length})
          </button>
        </div>

        {/* LEARN MODE */}
        {viewMode === "learn" && chapter.lesson && (
          <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 duration-300">
            <p className="font-semibold text-indigo-300">🎯 {chapter.lesson.objective}</p>
            <div className="mt-4 whitespace-pre-line leading-relaxed text-slate-300">{chapter.lesson.content}</div>
            <button
              onClick={() => setViewMode("play")}
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 font-semibold transition hover:bg-emerald-500"
            >
              พร้อมแล้ว → เริ่มภารกิจ ⚔️
            </button>
          </div>
        )}

        {/* PLAY MODE — การ์ดคำถามทีละใบ */}
        {viewMode === "play" && qIndex < chapter.quiz_questions.length && (
          <div className="mt-5">
            {/* Progress */}
            <div className="mb-4 flex items-center gap-3">
              <span className="shrink-0 text-sm font-bold text-slate-300">
                ข้อ {qIndex + 1}/{chapter.quiz_questions.length}
              </span>
              <div className="flex flex-1 gap-1">
                {chapter.quiz_questions.map((qq, i) => (
                  <span
                    key={qq.id}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                      answeredMap[String(qq.id)] !== undefined
                        ? "bg-emerald-500"
                        : i === qIndex
                          ? "bg-indigo-400"
                          : "bg-slate-800"
                    }`}
                  />
                ))}
              </div>
            </div>

            {(() => {
              const q = chapter.quiz_questions[qIndex];
              const result = results[q.id];
              const locked = Boolean(result);
              const selectedIdx = selected[q.id];
              const eliminated = hints[q.id] ?? [];
              const canHint =
                !locked && (gs.resources.knowledge ?? 0) >= 1 && eliminated.length === 0;
              const isLastQ = qIndex >= chapter.quiz_questions.length - 1;

              return (
                <div
                  key={q.id}
                  className={`eq-pop rounded-2xl border p-5 transition-all sm:p-6 ${
                    result
                      ? result.correct
                        ? "border-emerald-800/60 bg-emerald-950/15"
                        : "border-rose-800/60 bg-rose-950/15"
                      : "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <p className="text-base font-medium leading-relaxed sm:text-lg">{q.question}</p>
                    <span className="shrink-0 rounded-full bg-amber-950/50 px-2.5 py-1 text-xs font-bold text-amber-400">
                      +{q.points} XP
                    </span>
                  </div>

                  {q.source_reference && (
                    <p className="mb-3 text-xs text-slate-500">📚 Based on: {q.source_reference}</p>
                  )}

                  <div className="grid gap-2">
                    {q.options.map((opt, optIdx) => {
                      const isEliminated = eliminated.includes(optIdx);
                      let cls =
                        "border-slate-700 bg-slate-950 text-slate-300 hover:border-indigo-500/60 hover:bg-slate-900";
                      if (result) {
                        if (optIdx === result.correct_answer_index)
                          cls = "border-emerald-500 bg-emerald-950/50 font-bold text-emerald-300";
                        else if (optIdx === selectedIdx && !result.correct)
                          cls = "border-rose-500 bg-rose-950/50 text-rose-300 line-through opacity-70";
                        else cls = "border-slate-800 bg-slate-950/50 text-slate-600 opacity-60";
                      } else if (isEliminated) {
                        cls = "cursor-not-allowed border-slate-900 bg-slate-950/70 text-slate-700 line-through opacity-40";
                      } else if (selectedIdx === optIdx) {
                        cls = "border-indigo-500 bg-indigo-950/40 text-indigo-200 ring-1 ring-indigo-500";
                      }

                      return (
                        <button
                          key={optIdx}
                          disabled={locked || isEliminated || submittingId === q.id}
                          onClick={() => setSelected((prev) => ({ ...prev, [q.id]: optIdx }))}
                          className={`rounded-xl border px-4 py-2.5 text-left text-sm leading-relaxed transition-all ${cls}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 space-y-3">
                    {!result ? (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleAnswer(q.id, selectedIdx)}
                          disabled={selectedIdx === undefined || submittingId === q.id}
                          className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition-all active:scale-[0.98] disabled:bg-slate-800 disabled:text-slate-500 ${
                            hasCombat
                              ? "bg-gradient-to-r from-rose-600 to-red-500 text-white shadow-lg shadow-rose-950/50 hover:from-rose-500 hover:to-red-400"
                              : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-950/50 hover:from-indigo-500 hover:to-violet-500"
                          }`}
                        >
                          {submittingId === q.id ? "กำลังตรวจ..." : hasCombat ? "⚔️ โจมตี!" : "✅ ส่งคำตอบ"}
                        </button>
                        {canHint && (
                          <button
                            onClick={() => handleHint(q.id)}
                            disabled={hintLoading === q.id}
                            title="ใช้ Knowledge 1 ตัดตัวเลือกที่ผิด 1 ข้อ"
                            className="rounded-lg border border-yellow-700/60 bg-yellow-950/30 px-4 py-2.5 text-sm font-medium text-yellow-300 transition hover:bg-yellow-950/60 disabled:opacity-50"
                          >
                            {hintLoading === q.id ? "..." : `💡 ${gs.resources.knowledge}`}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div
                          className={`animate-in fade-in zoom-in-95 w-full rounded-lg p-3 duration-300 ${
                            result.correct ? "bg-emerald-950/50 text-emerald-200" : "bg-rose-950/50 text-rose-200"
                          }`}
                        >
                          <p className="mb-1 text-sm font-bold">
                            {hasCombat
                              ? result.correct
                                ? `💥 โจมตีสำเร็จ! +${result.xp_awarded} XP`
                                : `😵 ${enemy.name} โจมตีกลับ! -${result.enemy_damage ?? 0} HP`
                              : result.correct
                                ? `🎉 ถูกต้อง! +${result.xp_awarded} XP`
                                : "❌ ยังไม่ถูก"}
                          </p>
                          {result.explanation && <p className="text-sm leading-relaxed opacity-90">{result.explanation}</p>}
                          {result.source_reference && (
                            <p className="mt-2 text-xs opacity-70">📚 Based on: {result.source_reference}</p>
                          )}
                        </div>

                        {/* ปุ่มไปข้อถัดไป */}
                        <button
                          onClick={goNextQ}
                          className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-950/50 transition-all hover:from-indigo-500 hover:to-violet-500 active:scale-[0.99]"
                        >
                          {isLastQ ? "🏁 เสร็จสิ้นภารกิจของโซนนี้" : "ข้อถัดไป →"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

            {/* Checkpoint — ขึ้นทันทีเมื่อตอบครบ (ไม่ต้องมีกล่องซ้ำ) */}
            {chapterQuestionsAnswered && !checkpoint && (
              <button
                onClick={handleCompleteChapter}
                className="mt-5 w-full rounded-xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 py-4 text-lg font-black text-slate-950 shadow-xl shadow-orange-600/30 transition-all hover:scale-[1.01] hover:from-amber-300 hover:via-orange-300 active:scale-[0.99]"
              >
                🎯 ตอบครบแล้ว! บันทึก Checkpoint — รับโบนัส!
              </button>
            )}

            {checkpoint && (
              <div className="animate-in fade-in zoom-in-95 rounded-2xl border border-emerald-700/60 bg-emerald-950/25 p-6 text-center duration-300">
                <p className="text-4xl">🏁</p>
                <h3 className="mt-2 text-xl font-bold text-emerald-300">{checkpoint.message}</h3>
                <p className="mt-2 text-sm text-emerald-200/90">
                  Bonus +{checkpoint.bonus_xp} XP · Total {checkpoint.total_xp} XP · Lv.{checkpoint.level.level}
                </p>
                {checkpoint.badges_earned.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {checkpoint.badges_earned.map((b) => (
                      <span key={b.name} className="rounded-full border border-amber-600/50 bg-amber-950/40 px-4 py-1.5 text-sm font-semibold text-amber-300">
                        🏆 {b.name}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setScreen("map")}
                  className="mt-5 rounded-xl bg-emerald-600 px-8 py-3 font-bold transition hover:bg-emerald-500"
                >
                  🗺️ กลับแผนที่
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* RPG Dialogue overlay */}
      {dialogue && (
        <DialogueBox
          key={`${dialogue.name}-${chapter.chapter_id}`}
          npc={dialogue}
          chapterTitle={chapter.title}
          objective={chapter.lesson?.objective}
          visualStyle={visualStyle}
          onClose={() => setDialogue(null)}
        />
      )}

      {/* GAME OVER overlay */}
      {gameOver && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/85 p-6 backdrop-blur">
          <div className="eq-pop w-full max-w-sm rounded-3xl border-2 border-rose-800/70 bg-gradient-to-b from-rose-950/60 to-slate-900 p-8 text-center">
            <p className="text-6xl">💀</p>
            <h2 className="mt-3 text-2xl font-bold text-rose-300">GAME OVER</h2>
            <p className="mt-2 text-sm text-slate-400">
              HP หมดแล้ว! แต่ไม่เป็นไร — ฟื้นคืนชีพเพื่อเล่นต่อได้เลย (โทษ: เสีย Gold 10%)
            </p>
            <button
              onClick={handleRevive}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-lg font-bold text-slate-950 transition hover:from-emerald-400 hover:to-teal-400"
            >
              ✨ ฟื้นคืนชีพ
            </button>
            <button
              onClick={handleRestart}
              className="mt-3 w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300 transition hover:border-rose-500/60 hover:text-rose-300"
            >
              🔄 เริ่มใหม่ทั้งหมด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}





