// ==============================================================================
// lib/api.ts — EduQuest AI API Client (single source of truth)
// ==============================================================================

import { notifyAuthChanged } from "./useAuthToken";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const TOKEN_KEY = "eduquest_token";
const USER_KEY = "eduquest_user";

// ------------------------------------------------------------------------------
// Auth helpers
// ------------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  notifyAuthChanged();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifyAuthChanged();
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: string;
  plan?: string;
  quota_used_today?: number;
  current_streak?: number;
  longest_streak?: number;
}

export function getCachedUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

function cacheUser(user: CurrentUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {};
  const srcHeaders = new Headers(headers || {});
  srcHeaders.forEach((v, k) => {
    finalHeaders[k] = v;
  });

  if (auth) {
    const token = getToken();
    if (token) {
      finalHeaders["Authorization"] = `Bearer ${token}`;
    }
    const pk = getPlayerKey();
    if (pk) finalHeaders["X-Player-Key"] = pk;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      detail = typeof err.detail === "string" ? err.detail : detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ---- Guest player identity (ต่ออุปกรณ์) ----

export function getPlayerKey(): string {
  if (typeof window === "undefined") return "";
  let key = localStorage.getItem("eduquest_player_key");
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 24);
    localStorage.setItem("eduquest_player_key", key);
  }
  return key;
}

// ------------------------------------------------------------------------------
// Auth API
// ------------------------------------------------------------------------------

export async function loginRequest(email: string, password: string) {
  const body = new URLSearchParams({ username: email, password });
  const data = await request<{ access_token: string; token_type: string }>(
    "/api/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      auth: false,
    }
  );
  setToken(data.access_token);
  const me = await getMe();
  cacheUser(me);
  return data;
}

export async function registerRequest(
  name: string,
  email: string,
  password: string
): Promise<CurrentUser> {
  return request<CurrentUser>("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
    auth: false,
  });
}

export async function getMe(): Promise<CurrentUser> {
  return request<CurrentUser>("/api/users/me");
}

export function logout() {
  clearToken();
}

// Demo
const DEMO_EMAIL = "demo-teacher@eduquest.com";
const DEMO_PASSWORD = "demo12345";

export async function demoLogin(): Promise<boolean> {
  try {
    await loginRequest(DEMO_EMAIL, DEMO_PASSWORD);
    return true;
  } catch {
    try {
      await registerRequest("Demo Teacher", DEMO_EMAIL, DEMO_PASSWORD);
      await loginRequest(DEMO_EMAIL, DEMO_PASSWORD);
      return true;
    } catch (err) {
      console.error("Demo login failed:", err);
      return false;
    }
  }
}

// Quick Teacher Login — ปุ่มล็อกอินครูอัตโนมัติ
// ค่ามาจาก env บน Vercel (NEXT_PUBLIC_QUICK_LOGIN_*) — ไม่ hardcode ในโค้ด
// ตั้งตอน build: ถ้าไม่มีค่า ปุ่มจะไม่แสดง
const QUICK_EMAIL = process.env.NEXT_PUBLIC_QUICK_LOGIN_EMAIL;
const QUICK_PASSWORD = process.env.NEXT_PUBLIC_QUICK_LOGIN_PASSWORD;

export function hasQuickLogin(): boolean {
  return Boolean(QUICK_EMAIL && QUICK_PASSWORD);
}

export async function quickTeacherLogin(): Promise<boolean> {
  if (!QUICK_EMAIL || !QUICK_PASSWORD) return false;
  try {
    await loginRequest(QUICK_EMAIL, QUICK_PASSWORD);
    return true;
  } catch (err) {
    console.error("Quick teacher login failed:", err);
    return false;
  }
}

// ------------------------------------------------------------------------------
// Courses
// ------------------------------------------------------------------------------

export type CourseStatus = "DRAFT" | "GENERATING" | "READY" | "PUBLISHED" | "ARCHIVED";
export type VisualStyle = "pixel_art" | "modern_2d" | "fantasy" | "scifi";
export type GameLength = "short" | "medium" | "long";
export type QuestionType = "multiple_choice" | "true_false" | "matching" | "ordering";

export interface CourseSummary {
  id: number;
  teacher_id: number;
  title: string;
  description: string | null;
  subject: string | null;
  difficulty: string | null;
  game_modes: string[];
  visual_style: VisualStyle;
  status: CourseStatus;
  thumbnail: string | null;
  created_at: string;
}

export interface CreateCoursePayload {
  title: string;
  description?: string;
  subject?: string;
  difficulty?: string;
  gameModes: string[];
  visualStyle: VisualStyle;
  gameLength?: GameLength;
  questionTypes?: QuestionType[];
  questionsPerChapter?: number;
}

export async function createCourse(payload: CreateCoursePayload) {
  const formData = new FormData();
  formData.append("title", payload.title);
  formData.append("description", payload.description ?? "");
  formData.append("subject", payload.subject ?? "");
  formData.append("difficulty", payload.difficulty ?? "");
  formData.append("game_modes", JSON.stringify(payload.gameModes));
  formData.append("visual_style", payload.visualStyle);
  formData.append("game_length", payload.gameLength ?? "medium");
  formData.append("question_types", JSON.stringify(payload.questionTypes ?? ["multiple_choice"]));
  formData.append("questions_per_chapter", String(payload.questionsPerChapter ?? 3));
  return request<CourseSummary>("/api/courses", { method: "POST", body: formData });
}

export async function listCourses(): Promise<CourseSummary[]> {
  return request<CourseSummary[]>("/api/courses");
}

export async function deleteCourse(courseId: number) {
  return request<{ message: string }>(`/api/courses/${courseId}`, { method: "DELETE" });
}

export async function updateCourse(
  courseId: number,
  payload: {
    title?: string;
    description?: string;
    subject?: string;
    difficulty?: string;
    game_modes?: string[];
    visual_style?: VisualStyle;
    game_length?: GameLength;
    question_types?: QuestionType[];
  }
): Promise<CourseSummary> {
  return request<CourseSummary>(`/api/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function publishCourse(courseId: number) {
  return request<CourseSummary>(`/api/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "PUBLISHED" }),
  });
}

export type AccessMode = "private" | "unlisted" | "public";

export interface PublishResult {
  message: string;
  status: string;
  access_mode: AccessMode;
  share_token: string;
  share_path: string;
  share_code: string | null;
}

export async function publishGame(
  courseId: number,
  accessMode: AccessMode = "unlisted"
): Promise<PublishResult> {
  return request<PublishResult>(`/api/courses/${courseId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_mode: accessMode }),
  });
}

export interface ShareInfo {
  status: string;
  access_mode: AccessMode;
  share_token: string | null;
  share_path: string | null;
  share_code: string | null;
}

export async function resolveJoinCode(code: string): Promise<{ share_path: string; course_title: string }> {
  const normalized = code.trim().toUpperCase();
  return request<{ share_path: string; course_title: string }>(
    `/play/code/${encodeURIComponent(normalized)}`,
    { auth: false }
  );
}

export async function getShareInfo(courseId: number): Promise<ShareInfo> {
  return request<ShareInfo>(`/api/courses/${courseId}/share/info`);
}

export async function regenerateShareLink(courseId: number): Promise<{ share_path: string; share_code: string | null }> {
  return request<{ share_path: string; share_code: string | null }>(
    `/api/courses/${courseId}/share/regenerate`,
    { method: "POST" }
  );
}

export async function disableShareLink(courseId: number): Promise<{ message: string }> {
  return request<{ message: string }>(`/api/courses/${courseId}/share/disable`, { method: "POST" });
}

export async function archiveCourse(courseId: number): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/api/courses/${courseId}/archive`, {
    method: "POST",
  });
}

export async function restoreCourse(courseId: number): Promise<{ message: string; status: string }> {
  return request<{ message: string; status: string }>(`/api/courses/${courseId}/restore`, {
    method: "POST",
  });
}

// ------------------------------------------------------------------------------
// Leaderboard / Teacher report
// ------------------------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  is_me: boolean;
  last_played: string | null;
}

export interface Leaderboard {
  course_id: number;
  entries: LeaderboardEntry[];
  my_rank: number | null;
  total_players: number;
}

export async function getLeaderboard(courseId: number): Promise<Leaderboard> {
  return request<Leaderboard>(`/api/courses/${courseId}/leaderboard`);
}

export interface StudentReportRow {
  user_id: number;
  rank: number;
  name: string;
  best_score: number;
  best_chapters: number;
  best_accuracy: number;
  progress_percent: number;
  badges: number;
  sessions: number;
  completed: boolean;
  last_played: string | null;
}

export interface TeacherReport {
  course_id: number;
  course_title: string;
  total_chapters: number;
  summary: {
    students: number;
    average_score: number;
    average_accuracy_percent: number;
    completion_rate_percent: number;
  };
  students: StudentReportRow[];
}

export async function getCourseStudents(courseId: number): Promise<TeacherReport> {
  return request<TeacherReport>(`/api/courses/${courseId}/students`);
}

// ------------------------------------------------------------------------------
// Content editor (teacher only)
// ------------------------------------------------------------------------------

export interface EditableQuestion {
  id: number;
  question: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty: string;
  points: number;
  source_reference: string | null;
  question_type: QuestionType;
  matching_pairs: Array<{ left: string; right: string }> | null;
  ordering_items: string[] | null;
  correct_data: Record<string, string> | number[] | null;
}

export interface EditableChapter {
  chapter_id: number;
  title: string;
  order_index: number;
  lesson: { title: string; objective: string; content: string };
  quiz_questions: EditableQuestion[];
}

export interface CourseEditData {
  course_id: number;
  course_title: string;
  course_description: string | null;
  status: CourseStatus;
  game_modes: string[];
  visual_style: VisualStyle;
  chapters: EditableChapter[];
}

export async function getCourseEditData(courseId: number): Promise<CourseEditData> {
  return request<CourseEditData>(`/api/courses/${courseId}/edit-data`);
}

export async function createChapter(courseId: number, title: string) {
  return request<{ message: string; chapter_id: number; republish_required: boolean }>(
    `/api/courses/${courseId}/chapters`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }
  );
}

export async function updateChapter(
  courseId: number,
  chapterId: number,
  payload: {
    title?: string;
    lesson_title?: string;
    lesson_objective?: string;
    lesson_content?: string;
  }
) {
  return request<{ message: string; republish_required: boolean }>(
    `/api/courses/${courseId}/chapters/${chapterId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteChapter(courseId: number, chapterId: number) {
  return request<{ message: string; republish_required: boolean }>(
    `/api/courses/${courseId}/chapters/${chapterId}`,
    { method: "DELETE" }
  );
}

export async function reorderChapters(courseId: number, chapterIds: number[]) {
  return request<{ message: string; republish_required: boolean }>(
    `/api/courses/${courseId}/chapters/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_ids: chapterIds }),
    }
  );
}

export interface QuestionInput {
  question: string;
  options?: string[];
  correct_answer_index?: number;
  explanation?: string;
  difficulty?: string;
  points?: number;
  source_reference?: string | null;
  question_type: QuestionType;
  matching_pairs?: Array<{ left: string; right: string }> | null;
  ordering_items?: string[] | null;
  correct_data?: Record<string, string> | number[] | null;
}

export async function createQuestion(
  courseId: number,
  chapterId: number,
  payload: QuestionInput
) {
  return request<{ message: string; question: EditableQuestion; republish_required: boolean }>(
    `/api/courses/${courseId}/chapters/${chapterId}/questions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function updateQuestion(
  courseId: number,
  questionId: number,
  payload: QuestionInput
) {
  return request<{ message: string; question: EditableQuestion; republish_required: boolean }>(
    `/api/courses/${courseId}/questions/${questionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteQuestion(courseId: number, questionId: number) {
  return request<{ message: string; republish_required: boolean }>(
    `/api/courses/${courseId}/questions/${questionId}`,
    { method: "DELETE" }
  );
}

export function shareUrl(sharePath: string): string {
  if (typeof window === "undefined") return sharePath;
  return `${window.location.origin}${sharePath}`;
}

export async function getPublicCourse(token: string): Promise<CourseStructure> {
  return request<CourseStructure>(`/play/${token}`, { auth: false });
}

export interface PublicLeaderboard {
  course_id: number;
  course_title: string;
  entries: Array<{ rank: number; name: string; score: number }>;
  total_players: number;
}

export async function getPublicLeaderboard(token: string): Promise<PublicLeaderboard> {
  return request<PublicLeaderboard>(`/play/${token}/leaderboard`, { auth: false });
}

export const getAllCourses = listCourses;
export type Course = CourseSummary;

// ------------------------------------------------------------------------------
// Documents / Upload
// ------------------------------------------------------------------------------

export async function uploadDocument(courseId: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ message: string; document_id: number }>(
    `/api/courses/${courseId}/documents`,
    { method: "POST", body: formData }
  );
}

// ------------------------------------------------------------------------------
// AI: Analyze / Recommend / Generate
// ------------------------------------------------------------------------------

export interface GenerateResult {
  message: string;
  world_name: string;
  theme: string;
  chapters_created: string[];
  zones_created: number;
  npcs_created: number;
  enemies_created: number;
  bosses_created: number;
  levels_created: number;
  badges_created: number;
}

export async function generateGame(
  courseId: number,
  opts: {
    visualStyle?: VisualStyle;
    aiInstruction?: string;
    gameLength?: GameLength;
    questionTypes?: QuestionType[];
  } = {}
): Promise<GenerateResult> {
  const formData = new FormData();
  if (opts.visualStyle) formData.append("visual_style", opts.visualStyle);
  if (opts.aiInstruction) formData.append("ai_instruction", opts.aiInstruction);
  if (opts.gameLength) formData.append("game_length", opts.gameLength);
  if (opts.questionTypes) formData.append("question_types", JSON.stringify(opts.questionTypes));
  return request<GenerateResult>(`/api/courses/${courseId}/generate`, {
    method: "POST",
    body: formData,
  });
}

export const generateCourse = generateGame;
export const generateGamification = generateGame;

export interface ContentSufficiency {
  sufficient: boolean;
  level: "sufficient" | "borderline" | "insufficient";
  estimated_questions: number;
  recommended_length: GameLength;
  warnings: string[];
  suggestions: string[];
}

export async function analyzeContentSufficiency(
  courseId: number,
  gameLength: GameLength = "medium"
): Promise<ContentSufficiency> {
  const formData = new FormData();
  formData.append("game_length", gameLength);
  return request<{
    message: string;
    filename: string;
    game_length: GameLength;
    sufficiency: ContentSufficiency;
  }>(`/api/courses/${courseId}/analyze-content`, {
    method: "POST",
    body: formData,
  }).then((r) => r.sufficiency);
}

// ------------------------------------------------------------------------------
// Course Structure (public read)
// ------------------------------------------------------------------------------

export interface QuizQuestionView {
  id: number;
  question: string;
  options: string[];
  explanation: string;
  difficulty: string;
  points: number;
  source_reference: string | null;
  question_type: QuestionType;
  matching_pairs: Array<{ left: string; right: string }> | null;
  ordering_items: string[] | null;
  correct_data: Record<string, string> | number[] | null;
}

export interface LessonView {
  title: string;
  objective: string;
  content: string;
}

export interface ChapterView {
  chapter_id: number;
  title: string;
  lesson: LessonView | null;
  quiz_questions: QuizQuestionView[];
}

export interface ZoneView {
  name: string;
  chapter_index: number;
  chapter_id: number | null;
  environment: string;
  description: string;
}

export interface NpcView {
  name: string;
  role: string;
  personality: string;
  dialogue: string;
  related_concept: string;
}

export interface EnemyView {
  name: string;
  represents_concept: string;
  attack_description: string;
  weakness_hint: string;
  hp: number;
  xp_reward: number;
}

export interface BossView {
  name: string;
  title: string;
  phases: string[];
  total_hp: number;
  xp_reward: number;
  related_concepts: string[];
  source_reference: string;
}

export interface WorldView {
  world_name: string | null;
  intro_story: string | null;
  ending_story: string | null;
  visual_style: string;
  language?: string;
  zones: ZoneView[];
  npcs: NpcView[];
  enemies: EnemyView[];
  bosses: BossView[];
}

export interface LevelData {
  level: number;
  title: string;
  xp_required: number;
}

export interface BadgeData {
  name: string;
  description: string;
  condition_hint: string;
}

export interface CourseStructure {
  course_id: number;
  course_title: string;
  course_description: string | null;
  status: string;
  game_modes?: string[];
  art_bible?: {
    hero_id?: string;
    npcs?: { name: string; asset_id: string }[];
    enemies?: { name: string; asset_id: string }[];
    bosses?: { name: string; asset_id: string }[];
  } | null;
  world: WorldView | Record<string, never>;
  chapters: ChapterView[];
  gamification: { levels: LevelData[]; badges: BadgeData[] };
}

export async function getCourseStructure(courseId: number): Promise<CourseStructure> {
  return request<CourseStructure>(`/api/courses/${courseId}/structure`, { auth: false });
}

// ------------------------------------------------------------------------------
// Gameplay Sessions — backend-validated XP (anti-cheat)
// ------------------------------------------------------------------------------

export interface AnsweredRecord {
  answer: number | null;
  correct: boolean;
  correct_answer_index: number | null;
  explanation: string | null;
  source_reference: string | null;
  points?: number;
}

export interface Resources {
  gold: number;
  wood: number;
  stone: number;
  crystal: number;
  knowledge: number;
}

export interface RaidInfo {
  name: string;
  started_at: number;
  ends_at: number;
}

export interface EquippedItems {
  weapon: string | null;
  armor: string | null;
}

export interface PlayerStats {
  atk: number;
  def: number;
  crit: number;
  hp: number;
  weapon: string | null;
  armor: string | null;
}

export interface InventoryItemView {
  key: string;
  name: string;
  icon: string;
  type: "weapon" | "armor";
  rarity: string;
  stat_bonus: Partial<Record<"atk" | "def" | "crit", number>>;
  price: Partial<Resources>;
  description: string;
  owned: boolean;
  equipped: boolean;
}

export interface InventoryPayload {
  items: InventoryItemView[];
  owned: string[];
  equipped: EquippedItems;
  stats: PlayerStats;
}

export interface GameState {
  hp?: number;
  max_hp?: number;
  combo: number;
  best_combo: number;
  deaths: number;
  resources: Resources;
  buildings: string[];
  equipped?: EquippedItems;
  last_collected?: number;
  raid_cooldown_until?: number;
  raid?: RaidInfo | null;
  raids_repelled?: number;
}

export interface SkillInfo {
  streak: number;
  skill: string;
  name: string;
  desc: string;
}

export interface SessionState {
  session_id: number;
  created: boolean;
  fresh_run: boolean;
  xp: number;
  level?: LevelData;
  answered: Record<string, AnsweredRecord>;
  completed_chapters: number[];
  status: string;
  modes: string[];
  game_state: GameState;
  skills: SkillInfo[];
  pending?: Partial<Resources>;
  pending_per_building?: Record<string, Partial<Resources>>;
  raid?: RaidInfo | null;
  notice?: string | null;
  inventory?: InventoryPayload;
  player_stats?: PlayerStats;
  current_streak?: number;
  longest_streak?: number;
  streak_increased?: boolean;
}

export async function startSession(
  courseId: number,
  opts: { fresh?: boolean } = {}
): Promise<SessionState> {
  const query = opts.fresh ? "?fresh=true" : "";
  return request<SessionState>(`/api/courses/${courseId}/sessions${query}`, { method: "POST" });
}

export interface AnswerResult {
  already_answered: boolean;
  correct: boolean;
  question_type: QuestionType;
  correct_answer_index: number | null;
  correct_data: Record<string, string> | number[] | null;
  matching_pairs: Array<{ left: string; right: string }> | null;
  ordering_items: string[] | null;
  explanation?: string;
  source_reference?: string | null;
  points?: number;
  xp_awarded: number;
  xp_breakdown?: {
    accuracy_mult?: number;
    accuracy_tier?: string;
    combo_bonus?: number;
    building_multiplier?: number;
  };
  total_xp: number;
  resources_awarded?: Partial<Resources>;
  enemy_damage?: number;
  damage?: number;
  base_damage?: number;
  accuracy_tier?: string | null;
  accuracy_mult?: number | null;
  combo_mult?: number | null;
  crit?: boolean;
  crit_chance?: number | null;
  enemy_def?: number | null;
  player_stats?: PlayerStats;
  chapter_index?: number;
  is_boss?: boolean;
  game_state?: GameState;
  skills?: SkillInfo[];
  defeated?: boolean;
  raid_expired?: string | null;
}

export interface AnswerSubmitPayload {
  question_id: number;
  answer_index?: number;
  matching?: Record<string, string>;
  ordering?: number[];
  response_ms?: number;
}

export async function submitAnswer(
  sessionId: number,
  payload: AnswerSubmitPayload
): Promise<AnswerResult> {
  return request<AnswerResult>(`/api/sessions/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface CheckpointResult {
  message: string;
  newly_completed: boolean;
  bonus_xp: number;
  total_xp: number;
  level: LevelData;
  badges_earned: { name: string; description: string }[];
  item_reward?: { key: string; name: string; icon: string; type: string } | null;
  inventory?: InventoryPayload;
  player_stats?: PlayerStats;
  completed_chapters: number[];
  progress_percent: number;
  chapter_rewards?: Partial<Resources>;
  game_state?: GameState;
}

export async function completeChapter(
  sessionId: number,
  chapterId: number
): Promise<CheckpointResult> {
  return request<CheckpointResult>(`/api/sessions/${sessionId}/complete-chapter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapter_id: chapterId }),
  });
}

export interface GameResult {
  score: number;
  accuracy_percent: number;
  learning_coverage_percent: number;
  per_chapter: { chapter: string; percent: number; mastery_percent: number }[];
  needs_practice: string[];
  recommendations: string[];
  total_xp: number;
  questions_total: number;
  questions_attempted: number;
  questions_correct: number;
}

export async function finishSession(sessionId: number): Promise<GameResult> {
  return request<GameResult>(`/api/sessions/${sessionId}/finish`, { method: "POST" });
}

export interface ProgressSession {
  session_id: number;
  course_id: number;
  course_title: string | null;
  status: string;
  xp: number;
  chapters_completed: number;
  questions_answered: number;
  questions_correct: number;
  last_played: string | null;
}

export interface EarnedBadge {
  name: string;
  description: string;
  course_id: number;
  course_title: string;
  earned_at: string | null;
}

export interface MyProgress {
  total_xp: number;
  total_answers: number;
  total_correct: number;
  accuracy_percent: number;
  courses_played: number;
  current_streak: number;
  longest_streak: number;
  badges: EarnedBadge[];
  quota: {
    plan: string;
    plan_label: string;
    quota_used: number;
    quota_limit: number;
    quota_remaining: number;
  };
  sessions: ProgressSession[];
}

export async function getMyProgress(): Promise<MyProgress> {
  return request<MyProgress>("/api/users/me/progress");
}

// ------------------------------------------------------------------------------
// Inventory / Equipment
// ------------------------------------------------------------------------------

export async function getInventory(sessionId: number): Promise<InventoryPayload> {
  return request<InventoryPayload>(`/api/sessions/${sessionId}/inventory`);
}

export async function equipItem(sessionId: number, itemKey: string) {
  return request<{ message: string; inventory: InventoryPayload; player_stats: PlayerStats; game_state: GameState }>(
    `/api/sessions/${sessionId}/inventory/equip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: itemKey }),
    }
  );
}

export async function unequipItem(sessionId: number, itemKey: string) {
  return request<{ message: string; inventory: InventoryPayload; player_stats: PlayerStats; game_state: GameState }>(
    `/api/sessions/${sessionId}/inventory/unequip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: itemKey }),
    }
  );
}

export async function buyItem(sessionId: number, itemKey: string) {
  return request<{ message: string; inventory: InventoryPayload; player_stats: PlayerStats; game_state: GameState }>(
    `/api/sessions/${sessionId}/inventory/buy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: itemKey }),
    }
  );
}

// ---- Base Economy v2 ----

export const RESOURCE_META: Record<keyof Resources, { icon: string; label: string }> = {
  gold: { icon: "💰", label: "Gold" },
  wood: { icon: "🪵", label: "Wood" },
  stone: { icon: "🪨", label: "Stone" },
  crystal: { icon: "💎", label: "Crystal" },
  knowledge: { icon: "📖", label: "Knowledge" },
};

export const PASSIVE_YIELD: Record<string, Partial<Record<keyof Resources, number>>> = {
  house: { gold: 2 },
  farm: { gold: 6 },
  mine: { stone: 4 },
  workshop: { wood: 3 },
  library: { knowledge: 1 },
  academy: { knowledge: 1 },
  castle: { crystal: 1 },
};

export interface SessionStatus {
  game_state: GameState;
  pending: Partial<Resources>;
  pending_per_building: Record<string, Partial<Resources>>;
  raid: RaidInfo | null;
  notice?: string | null;
}

export async function getSessionStatus(sessionId: number): Promise<SessionStatus> {
  return request<SessionStatus>(`/api/sessions/${sessionId}/status`);
}

export interface CollectResult {
  message: string;
  collected: Partial<Resources>;
  game_state: GameState;
  raid_expired?: string | null;
}

export async function collectProduction(sessionId: number): Promise<CollectResult> {
  return request<CollectResult>(`/api/sessions/${sessionId}/collect`, { method: "POST" });
}

export interface RaidQuestion {
  question_id: number;
  question: string;
  options: string[];
  points: number;
}

export async function getRaidQuestion(sessionId: number): Promise<RaidQuestion> {
  return request<RaidQuestion>(`/api/sessions/${sessionId}/raid/question`, { method: "POST" });
}

export interface RaidDefendResult {
  repelled: boolean;
  expired?: boolean;
  message: string;
  loot?: Partial<Resources>;
  xp_bonus?: number;
  total_xp?: number;
  correct_answer_index?: number | null;
  explanation?: string | null;
  game_state: GameState;
}

export async function defendRaid(
  sessionId: number,
  payload: { question_id: number; answer_index: number }
): Promise<RaidDefendResult> {
  return request<RaidDefendResult>(`/api/sessions/${sessionId}/raid/defend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface ReviveResult {
  message: string;
  game_state: GameState;
  lost_gold: number;
}

export async function reviveSession(sessionId: number): Promise<ReviveResult> {
  return request<ReviveResult>(`/api/sessions/${sessionId}/revive`, { method: "POST" });
}

export interface BuildResult {
  message: string;
  building: string;
  game_state: GameState;
}

export async function buildBuilding(
  sessionId: number,
  buildingId: string
): Promise<BuildResult> {
  return request<BuildResult>(`/api/sessions/${sessionId}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ building_id: buildingId }),
  });
}

export interface HintResult {
  eliminated_option: number;
  game_state: GameState;
  message: string;
}

export async function requestHint(
  sessionId: number,
  questionId: number
): Promise<HintResult> {
  return request<HintResult>(`/api/sessions/${sessionId}/hint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: questionId }),
  });
}

export const BUILDING_CATALOG: Record<
  string,
  {
    name: string;
    icon: string;
    cost: Partial<Record<keyof Resources, number>>;
    unlock_chapters: number;
    effect_text: string;
    requires?: string[];
  }
> = {
  house: { name: "บ้าน", icon: "🏠", cost: { wood: 20, stone: 10 }, unlock_chapters: 0, effect_text: "+20 Max HP" },
  farm: { name: "ไร่", icon: "🌾", cost: { gold: 30 }, unlock_chapters: 0, effect_text: "+5 Gold/ตอบถูก" },
  mine: { name: "เหมืองหิน", icon: "⛏️", cost: { wood: 15 }, unlock_chapters: 1, effect_text: "+3 Stone/ตอบถูก" },
  workshop: { name: "โรงฝึกงาน", icon: "🔨", cost: { stone: 20, wood: 10 }, unlock_chapters: 1, effect_text: "+2 Wood/ตอบถูก" },
  library: { name: "ห้องสมุด", icon: "📚", cost: { gold: 40, wood: 20 }, unlock_chapters: 2, effect_text: "+1 Knowledge/ตอบถูก" },
  academy: { name: "สถาบันการศึกษา", icon: "🏛️", cost: { gold: 60, stone: 30, knowledge: 10 }, unlock_chapters: 2, effect_text: "XP +25%" },
  castle: { name: "ปราสาท", icon: "🏰", cost: { wood: 50, stone: 50, crystal: 10 }, unlock_chapters: 3, effect_text: "🏆 เป้าหมายสูงสุด!", requires: ["house", "farm", "library"] },
};
