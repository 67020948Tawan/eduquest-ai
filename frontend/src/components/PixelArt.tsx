"use client";

// ==============================================================================
// PixelArt.tsx — Procedural Pixel Art Engine
//
// สร้างกราฟิกเกมจริงด้วยโค้ดล้วนๆ (ไม่ต้องพึ่ง AI Image API):
//   <PixelSprite kind="hero|npc|enemy|boss" />   → ตัวละคร/ศัตรู/บอส
//   <PixelScene environment="village|forest..." /> → ฉากแต่ละโซน
//
// หลักการ:
//   - Seed จากชื่อ entity → ภาพ deterministic (ชื่อเดิม = ภาพเดิม = Asset Consistency)
//   - Palette ผูกกับ visual_style ของเกม (Pixel Art / Fantasy / Sci-Fi / Modern)
// ==============================================================================

import { useEffect, useRef } from "react";

// ------------------------------------------------------------------------------
// Seeded RNG — deterministic ต่อชื่อ
// ------------------------------------------------------------------------------

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------
// Themes ต่อ visual style — ใช้ทั้งฉากและ palette ของตัวละคร
// ------------------------------------------------------------------------------

interface Theme {
  sky: string[];
  ground: string;
  groundDark: string;
  tree: string;
  treeDark: string;
  stone: string;
  stoneDark: string;
  building: string;
  buildingDark: string;
  roof: string;
  accent: string;
  outline: string;
  skin: string[];
  cloth: string[];
  enemyBody: string[];
  bossBody: string[];
  night?: boolean;
}

const THEMES: Record<string, Theme> = {
  pixel_art: {
    sky: ["#5aa9ff", "#84c1ff", "#b8dcff"],
    ground: "#59b04f", groundDark: "#3c7d38",
    tree: "#2f8f43", treeDark: "#1e6330",
    stone: "#9aa0ad", stoneDark: "#5c6070",
    building: "#e8d9b0", buildingDark: "#c4ae82",
    roof: "#d9534f", accent: "#ffd75e",
    outline: "#22223a",
    skin: ["#f5c89e", "#e0a878", "#c68642", "#8d5524"],
    cloth: ["#3b6fd4", "#d43b3b", "#3ba55d", "#8e44ad", "#e67e22"],
    enemyBody: ["#9b59b6", "#27ae60", "#c0392b", "#d35400", "#16a085"],
    bossBody: ["#7d3c98", "#922b21", "#1a5276"],
  },
  fantasy: {
    sky: ["#7e6bc4", "#a88fe0", "#d3c5f1"],
    ground: "#4f8a5b", groundDark: "#35603f",
    tree: "#39704b", treeDark: "#254d33",
    stone: "#a99bb8", stoneDark: "#6b5f7d",
    building: "#ded0ea", buildingDark: "#b5a3cc",
    roof: "#8e44ad", accent: "#ffd700",
    outline: "#1d1230",
    skin: ["#f5c89e", "#e0a878", "#c68642"],
    cloth: ["#5b2c6f", "#1f618d", "#b03a2e", "#148f77"],
    enemyBody: ["#6c3483", "#1e8449", "#943126", "#b9770e"],
    bossBody: ["#4a235a", "#7b241c", "#154360"],
  },
  scifi: {
    sky: ["#0b1026", "#131a38", "#1d2648"],
    ground: "#22304f", groundDark: "#151f38",
    tree: "#1d5c50", treeDark: "#123c35",
    stone: "#3a4769", stoneDark: "#232c47",
    building: "#182142", buildingDark: "#101630",
    roof: "#00e5ff", accent: "#ff2bd6",
    outline: "#05070f",
    skin: ["#f5c89e", "#e0a878", "#bfa7ff", "#8be0d0"],
    cloth: ["#00bcd4", "#7c4dff", "#ff4081", "#00e676"],
    enemyBody: ["#00acc1", "#ab47bc", "#ef5350", "#66bb6a"],
    bossBody: ["#d500f9", "#ff1744", "#2979ff"],
    night: true,
  },
  modern_2d: {
    sky: ["#aee3f5", "#cdeef9", "#eaf8fd"],
    ground: "#7ccb6f", groundDark: "#5aa851",
    tree: "#54a054", treeDark: "#3d7a3d",
    stone: "#b8bcc8", stoneDark: "#888da0",
    building: "#fdf3dd", buildingDark: "#ead9b5",
    roof: "#f28c5a", accent: "#ffd166",
    outline: "#3a3f52",
    skin: ["#f5c89e", "#e0a878", "#c68642", "#8d5524"],
    cloth: ["#4d96ff", "#ff6b6b", "#6bcb77", "#9b5de5", "#ffa62b"],
    enemyBody: ["#b388eb", "#80cbc4", "#ff8a65", "#f06292"],
    bossBody: ["#7e57c2", "#ef5350", "#42a5f5"],
  },
};

export function getTheme(style: string | undefined): Theme {
  return THEMES[style || "pixel_art"] || THEMES.pixel_art;
}

// ------------------------------------------------------------------------------
// Base component — canvas วาด pixel unit 1x1 แล้ว upscale ด้วย CSS (crisp)
// ------------------------------------------------------------------------------

function PixelCanvas({
  logicalWidth,
  logicalHeight,
  displayWidth,
  seed,
  draw,
}: {
  logicalWidth: number;
  logicalHeight: number;
  displayWidth: number;
  seed: string;
  draw: (ctx: CanvasRenderingContext2D, rng: () => number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = logicalWidth;
    canvas.height = logicalHeight;
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    ctx.imageSmoothingEnabled = false;

    draw(ctx, mulberry32(hashString(seed)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, styleKey(draw)]);

  const displayHeight = Math.round((displayWidth * logicalHeight) / logicalWidth);

  return (
    <canvas
      ref={ref}
      style={{
        width: displayWidth,
        height: displayHeight,
        imageRendering: "pixelated",
        display: "block",
      }}
      aria-hidden="true"
    />
  );
}

// stable-ish key เพื่อให้ redraw เมื่อ draw function เปลี่ยน (เช่นเปลี่ยน kind/style)
function styleKey(fn: unknown): string {
  return typeof fn === "function" ? "f" : String(fn);
}

// ------------------------------------------------------------------------------
// SPRITE: humanoid (hero / npc) — 16x16 พร้อม floating animation
// ------------------------------------------------------------------------------

export function PixelSprite({
  kind,
  seed,
  style,
  size = 48,
  floating = false,
}: {
  kind: "hero" | "npc" | "enemy" | "boss";
  seed: string;
  style?: string;
  size?: number;
  /** ทำให้ตัวละครลอยขึ้นลงเบาๆ เหมือนมีชีวิต */
  floating?: boolean;
}) {
  const theme = getTheme(style);
  const draw = makeSpriteDrawer(kind, theme);
  return (
    <span
      className={floating ? "eq-float-idle inline-block" : "inline-block"}
      style={{ display: "inline-block", lineHeight: 0 }}
    >
      <PixelCanvas
        logicalWidth={kind === "boss" ? 24 : 16}
        logicalHeight={kind === "boss" ? 24 : 16}
        displayWidth={size}
        seed={`${style || ""}|${kind}|${seed}`}
        draw={draw}
      />
    </span>
  );
}

function makeSpriteDrawer(kind: string, theme: Theme) {
  return (ctx: CanvasRenderingContext2D, rng: () => number) => {
    const O = theme.outline;
    if (kind === "enemy") return drawEnemy(ctx, rng, theme, O, false);
    if (kind === "boss") return drawEnemy(ctx, rng, theme, O, true);
    return drawHumanoid(ctx, rng, theme, O, kind === "hero");
  };
}

function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  theme: Theme,
  O: string,
  isHero: boolean
) {
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)];
  const skin = pick(theme.skin);
  let cloth = isHero ? theme.cloth[0] : pick(theme.cloth);
  const pants = theme.outline;
  const hairColors = ["#2c222b", "#4a3123", "#7b4b2a", "#b8860b", "#d9534f", "#3b6fd4"];
  const hair = pick(hairColors);
  const hairStyle = Math.floor(rng() * 3); // 0 flat, 1 spiky, 2 hood/long
  const hasCape = isHero && rng() > 0.5;
  if (hasCape) cloth = pick(theme.cloth);

  const dot = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };

  // Cape (ด้านหลังตัว)
  if (hasCape) {
    for (let y = 6; y <= 13; y++) {
      const w = y <= 8 ? 8 : 10 - (y - 9);
      for (let x = 3; x < 3 + w && x <= 12; x++) {
        if ((y >= 12 && (x === 3 || x === 3 + w - 1))) continue;
        dot(x, y, shade(cloth, -25));
      }
    }
  }

  // Head (rows 2-6)
  rect(ctx, 5, 2, 6, 5, skin);
  outlineRect(ctx, 5, 2, 6, 5, O);

  // Hair
  if (hairStyle === 0) {
    rect(ctx, 5, 1, 6, 2, hair);
  } else if (hairStyle === 1) {
    rect(ctx, 5, 1, 6, 2, hair);
    dot(5, 0, hair); dot(7, 0, hair); dot(9, 0, hair); dot(11, 0, hair);
  } else {
    rect(ctx, 4, 1, 8, 2, hair);
    dot(4, 2, hair); dot(11, 2, hair); dot(4, 3, hair); dot(11, 3, hair);
  }

  // Eyes
  dot(6, 4, O); dot(9, 4, O);
  dot(6, 5, shade(skin, -18)); dot(9, 5, shade(skin, -18));

  // Body (rows 7-11)
  rect(ctx, 4, 7, 8, 5, cloth);
  outlineRect(ctx, 4, 7, 8, 5, O);
  rect(ctx, 4, 10, 8, 1, shade(cloth, -35)); // belt

  // Arms
  rect(ctx, 3, 7, 1, 4, cloth);
  dot(3, 11, skin);
  rect(ctx, 12, 7, 1, 4, cloth);
  dot(12, 11, skin);

  // Legs (rows 12-14)
  rect(ctx, 5, 12, 2, 3, pants);
  rect(ctx, 9, 12, 2, 3, pants);

  // Boots (row 15)
  rect(ctx, 5, 15, 2, 1, shade(pants, 40));
  rect(ctx, 9, 15, 2, 1, shade(pants, 40));

  // Hero emblem
  if (isHero) {
    dot(7, 8, theme.accent);
    dot(8, 8, theme.accent);
    dot(7, 9, theme.accent);
    dot(8, 9, theme.accent);
  }
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  theme: Theme,
  O: string,
  isBoss: boolean
) {
  const S = isBoss ? 24 : 16;
  const bodyBase = isBoss
    ? theme.bossBody[Math.floor(rng() * theme.bossBody.length)]
    : theme.enemyBody[Math.floor(rng() * theme.enemyBody.length)];
  const body = bodyBase;
  const bodyLight = shade(body, 30);
  const bodyDark = shade(body, -30);

  const cx = S / 2;
  const top = isBoss ? 4 : 3;
  const bottom = S - 2;

  // Crown สำหรับบอส
  if (isBoss) {
    for (let x = cx - 5; x <= cx + 4; x += 2) {
      dot(ctx, x, top - 2, theme.accent);
      dot(ctx, x, top - 1, theme.accent);
    }
    rect(ctx, cx - 5, top - 1, 10, 1, theme.accent);
  }

  // Body — symmetric blob
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top);
    // profile: narrow top → wide middle → taper bottom
    let hw: number;
    if (t < 0.25) hw = 2 + t * 8;
    else if (t < 0.75) hw = 4 + Math.sin((t - 0.25) * Math.PI) * (isBoss ? 7 : 4);
    else hw = (isBoss ? 8 : 5) * (1 - (t - 0.75)) + 1;
    hw = Math.max(1, Math.min(hw + rng() * 1.2, S / 2 - 1));

    for (let dx = -hw; dx <= hw; dx++) {
      const x = Math.round(cx + dx);
      const edge = Math.abs(dx) > hw - 1.2;
      dot(ctx, x, y, edge ? bodyDark : body);
    }
  }
  outlineBlobEdges(ctx, cx, top, bottom, S, O);

  // Belly patch
  const bellyTop = Math.round(top + (bottom - top) * 0.55);
  for (let y = bellyTop; y < bottom - 1; y++) {
    for (let x = Math.round(cx - 2); x <= Math.round(cx + 1); x++) {
      dot(ctx, x, y, bodyLight);
    }
  }

  // Horns
  if (rng() > 0.3 || isBoss) {
    const hornC = isBoss ? theme.accent : shade(body, 60);
    dot(ctx, Math.round(cx - 4), top - 1, hornC);
    dot(ctx, Math.round(cx - 4), top - 2, hornC);
    dot(ctx, Math.round(cx + 3), top - 1, hornC);
    dot(ctx, Math.round(cx + 3), top - 2, hornC);
    if (isBoss) {
      dot(ctx, Math.round(cx - 6), top, hornC);
      dot(ctx, Math.round(cx + 5), top, hornC);
    }
  }

  // Eyes (glowing สำหรับบอส)
  const eyeY = Math.round(top + (bottom - top) * 0.32);
  const eyeX = Math.round(S * 0.18);
  const eyeWhite = isBoss ? "#ffe066" : "#ffffff";
  dot(ctx, eyeX, eyeY, eyeWhite);
  dot(ctx, S - 1 - eyeX, eyeY, eyeWhite);
  dot(ctx, eyeX, eyeY + 1, O);
  dot(ctx, S - 1 - eyeX, eyeY + 1, O);
  // Angry brows
  dot(ctx, eyeX - 1, eyeY - 1, O);
  dot(ctx, S - eyeX, eyeY - 1, O);

  // Mouth + teeth
  const mouthY = Math.round(top + (bottom - top) * 0.55);
  const mStart = Math.round(cx - (isBoss ? 4 : 3));
  for (let x = mStart; x < mStart + (isBoss ? 9 : 7); x++) {
    dot(ctx, x, mouthY, O);
    if ((x - mStart) % 2 === 0) dot(ctx, x, mouthY - 1, "#fff");
  }

  // Feet
  const footY = bottom + 1;
  dot(ctx, Math.round(cx - 3), footY, O);
  dot(ctx, Math.round(cx + 2), footY, O);
}

// ------------------------------------------------------------------------------
// BUILDING SPRITE — สำหรับระบบ Base Building (16x16)
// ------------------------------------------------------------------------------

export function PixelBuilding({
  buildingId,
  style,
  size = 56,
}: {
  buildingId: string;
  style?: string;
  size?: number;
}) {
  const theme = getTheme(style);
  return (
    <PixelCanvas
      logicalWidth={16}
      logicalHeight={16}
      displayWidth={size}
      seed={`bld|${style}|${buildingId}`}
      draw={(ctx, rng) => drawBuilding(ctx, rng, theme, buildingId)}
    />
  );
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  t: Theme,
  id: string
) {
  const O = t.outline;
  switch (id) {
    case "house":
      rect(ctx, 4, 8, 8, 6, t.building);
      for (let i = 0; i < 4; i++) rect(ctx, 3 + i, 7 - i, 10 - i * 2, 1, t.roof);
      rect(ctx, 7, 11, 2, 3, "#5d4037");
      dot(ctx, 5, 9, t.accent);
      outlineRect(ctx, 4, 8, 8, 6, O);
      break;
    case "farm":
      rect(ctx, 2, 10, 12, 4, "#8d6e63");
      for (let r = 0; r < 3; r++) rect(ctx, 2, 10 + r * 1.4, 12, 1, r % 2 ? "#a1887f" : "#795548");
      for (let i = 0; i < 5; i++) dot(ctx, 3 + i * 2.5, 9 - (i % 2), "#7cb342");
      rect(ctx, 10, 5, 4, 4, t.roof);
      rect(ctx, 11, 7, 2, 2, t.buildingDark);
      break;
    case "mine":
      rect(ctx, 3, 6, 10, 8, t.stoneDark);
      outlineRect(ctx, 3, 6, 10, 8, O);
      rect(ctx, 6, 9, 4, 5, "#14141c");
      rect(ctx, 5, 5, 6, 1, "#795548");
      rect(ctx, 5, 4, 1, 2, "#795548");
      rect(ctx, 10, 4, 1, 2, "#795548");
      dot(ctx, 7, 11, t.accent); // แสงไฟในเหมือง
      break;
    case "workshop":
      rect(ctx, 3, 8, 10, 6, t.buildingDark);
      for (let i = 0; i < 3; i++) rect(ctx, 2 + i, 7 - i, 12 - i * 2, 1, shade(t.roof, -30));
      rect(ctx, 11, 3, 2, 4, t.stoneDark); // ปล่องไฟ
      dot(ctx, 12, 2, "#cfd8dc");
      dot(ctx, 13, 1, "#eceff1");
      rect(ctx, 5, 10, 3, 3, "#37474f"); // ทั่ง
      break;
    case "library":
      rect(ctx, 4, 5, 8, 9, t.building);
      rect(ctx, 3, 3, 10, 2, t.roof);
      for (const cx of [5, 8, 11]) rect(ctx, cx, 6, 1, 6, t.stone);
      rect(ctx, 6, 12, 4, 2, "#5d4037");
      dot(ctx, 8, 7, t.accent);
      break;
    case "academy":
      rect(ctx, 3, 6, 10, 8, t.building);
      rect(ctx, 2, 3, 12, 3, t.roof);
      dot(ctx, 8, 2, t.accent); // โลโก้บนหลังคา
      for (const cx of [4, 7, 10]) {
        rect(ctx, cx, 7, 2, 5, t.buildingDark);
        rect(ctx, cx, 7, 2, 1, t.stone);
      }
      rect(ctx, 6, 13, 4, 1, "#5d4037");
      break;
    case "castle":
      rect(ctx, 5, 8, 6, 6, t.stone);
      for (const tx of [2, 12]) {
        rect(ctx, tx, 5, 3, 9, t.stoneDark);
        rect(ctx, tx, 4, 3, 1, t.roof);
        dot(ctx, tx + 1, 3, t.roof);
        dot(ctx, tx + 1, 7, "#14141c");
      }
      for (let b = 0; b < 6; b += 2) dot(ctx, 5 + b, 7, t.stone);
      rect(ctx, 7, 11, 2, 3, "#14141c"); // ประตู
      dot(ctx, 8, 9, t.accent);
      break;
    default:
      rect(ctx, 4, 8, 8, 6, t.building);
      outlineRect(ctx, 4, 8, 8, 6, O);
  }
  void rng;
}

// ------------------------------------------------------------------------------
// SCENE: zone environments — 64x36 (+ Animated mode: เมฆลอย ดาวกะพริบ น้ำแฉะแสง)
// ------------------------------------------------------------------------------

export function PixelScene({
  environment,
  seed,
  style,
  width,
  animated = false,
}: {
  environment: string;
  seed: string;
  style?: string;
  /** เลข = กว้างคงที่ (px) · ไม่ใส่ = ยืดเต็ม container (responsive) */
  width?: number;
  /** เปิด animation loop (เมฆลอย / ดาวกะพริบ) — ใช้กับ banner/battle stage */
  animated?: boolean;
}) {
  const theme = getTheme(style);
  const env = normalizeEnv(environment);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ---- Render static base ลง offscreen ครั้งเดียว ----
    const base = document.createElement("canvas");
    base.width = 64;
    base.height = 36;
    const bctx = base.getContext("2d");
    if (!bctx) return;

    const rng = mulberry32(hashString(`${style || ""}|scene|${env}|${seed}`));
    drawScene(bctx, rng, theme, env);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0);

    if (!animated) return;

    // ---- Animation elements (deterministic จาก seed เดิม) ----
    const arng = mulberry32(hashString(`${seed}|anim`));
    const clouds = Array.from({ length: 4 }, () => ({
      x: arng() * 70 - 5,
      y: 1 + arng() * 9,
      w: 4 + Math.floor(arng() * 6),
      speed: 0.015 + arng() * 0.03,
      alpha: 0.5 + arng() * 0.3,
    }));
    const stars =
      theme.night
        ? Array.from({ length: 18 }, () => ({
            x: Math.floor(arng() * 64),
            y: Math.floor(arng() * 20),
            phase: arng() * Math.PI * 2,
          }))
        : [];
    const sparkles =
      env === "river"
        ? Array.from({ length: 10 }, () => ({
            x: Math.floor(arng() * 60),
            y: 29 + Math.floor(arng() * 4),
            phase: arng() * Math.PI * 2,
          }))
        : [];

    let raf = 0;
    let frame = 0;
    let lastDraw = 0;

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - lastDraw < 50) return; // ~20fps — pixel art ไม่ต้องลื่นสุด
      lastDraw = ts;
      frame++;

      ctx.clearRect(0, 0, 64, 36);
      ctx.drawImage(base, 0, 0);

      // Stars twinkle
      for (const s of stars) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.08 + s.phase));
        ctx.fillStyle = `rgba(230,240,255,${a.toFixed(2)})`;
        ctx.fillRect(s.x, s.y, 1, 1);
      }

      // Clouds drift
      for (const c of clouds) {
        c.x += c.speed;
        if (c.x > 66) c.x = -c.w - 2;
        const cx = Math.floor(c.x);
        const col =
          theme.night
            ? `rgba(140,160,220,${(c.alpha * 0.35).toFixed(2)})`
            : `rgba(255,255,255,${c.alpha.toFixed(2)})`;
        for (let dx = 0; dx < c.w; dx++) {
          const bump = dx === 0 || dx === c.w - 1 ? 1 : 0;
          ctx.fillStyle = col;
          ctx.fillRect(cx + dx, Math.round(c.y) + bump, 1, 2 - bump);
        }
        ctx.fillStyle = col;
        ctx.fillRect(cx + 1, Math.round(c.y) - 1, Math.max(1, c.w - 2), 1);
      }

      // River sparkle
      for (const s of sparkles) {
        const a = Math.abs(Math.sin(frame * 0.06 + s.phase));
        if (a > 0.55) {
          ctx.fillStyle = `rgba(200,230,255,${a.toFixed(2)})`;
          ctx.fillRect(s.x, s.y, 2, 1);
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, animated]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={36}
      style={{
        width: width != null ? width : "100%",
        height: "auto",
        imageRendering: "pixelated",
        display: "block",
      }}
      aria-hidden="true"
    />
  );
}

function normalizeEnv(environment: string): string {
  const e = (environment || "").toLowerCase();
  if (e.includes("village")) return "village";
  if (e.includes("forest")) return "forest";
  if (e.includes("mountain")) return "mountain";
  if (e.includes("castle")) return "castle";
  if (e.includes("dungeon") || e.includes("cave")) return "dungeon";
  if (e.includes("city")) return "city";
  if (e.includes("laboratory") || e.includes("lab")) return "laboratory";
  if (e.includes("river") || e.includes("lake") || e.includes("sea")) return "river";
  return "forest";
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  theme: Theme,
  env: string
) {
  const W = 64, H = 36, horizon = 26;

  // Sky bands
  const sky = theme.sky;
  const bandH = Math.ceil(horizon / sky.length);
  sky.forEach((c, i) => rect(ctx, 0, i * bandH, W, bandH, c));

  // Stars (night themes)
  if (theme.night) {
    for (let i = 0; i < 26; i++) {
      dot(ctx, Math.floor(rng() * W), Math.floor(rng() * (horizon - 6)), "#e6f0ff");
    }
  }

  // Sun / Moon
  const sunX = 8 + Math.floor(rng() * 20);
  rect(ctx, sunX, 4, 4, 4, theme.night ? "#e8e8ff" : theme.accent);
  dot(ctx, sunX - 1, 5, theme.night ? "#c5c5e8" : shade(theme.accent, 30));
  dot(ctx, sunX + 4, 5, theme.night ? "#c5c5e8" : shade(theme.accent, 30));

  // Distant hills
  for (let x = 0; x < W; x++) {
    const h = 4 + Math.round(Math.sin(x * 0.22 + rngSeedNoise(rng)) * 2);
    rect(ctx, x, horizon - h, 1, h + 2, shade(theme.tree, theme.night ? -55 : -25));
  }

  // Ground
  rect(ctx, 0, horizon, W, H - horizon, theme.ground);
  rect(ctx, 0, horizon, W, 1, theme.groundDark);
  for (let i = 0; i < 30; i++) {
    dot(ctx, Math.floor(rng() * W), horizon + 2 + Math.floor(rng() * (H - horizon - 2)), theme.groundDark);
  }

  switch (env) {
    case "village": {
      for (let i = 0; i < 3; i++) {
        const bx = 6 + i * 19 + Math.floor(rng() * 4);
        house(ctx, bx, horizon - 1, theme, rng);
      }
      break;
    }
    case "forest": {
      for (let i = 0; i < 6; i++) {
        const tx = 3 + i * 10 + Math.floor(rng() * 5);
        const th = 8 + Math.floor(rng() * 5);
        pine(ctx, tx, horizon - 1, th, theme);
      }
      break;
    }
    case "mountain": {
      peak(ctx, 14, horizon, 16, theme.stone, theme.accent, theme.night);
      peak(ctx, 34, horizon, 20, theme.stoneDark, theme.accent, theme.night);
      peak(ctx, 52, horizon, 12, theme.stone, theme.accent, theme.night);
      break;
    }
    case "castle": {
      castle(ctx, 18, horizon - 1, theme);
      break;
    }
    case "dungeon": {
      // dark cave
      rect(ctx, 0, 0, W, horizon, theme.night ? "#0a0a14" : "#17172b");
      for (let i = 0; i < 10; i++) {
        const sx = Math.floor(rng() * W);
        rect(ctx, sx, 0, 1, 3 + Math.floor(rng() * 5), theme.stoneDark);
      }
      // torch glow
      const tx = 46;
      rect(ctx, tx, 18, 2, 3, theme.accent);
      rect(ctx, tx, 21, 1, 6, "#6b4a2a");
      rect(ctx, 0, horizon, W, H - horizon, theme.stoneDark);
      for (let i = 0; i < 20; i++) {
        dot(ctx, Math.floor(rng() * W), horizon + 2 + Math.floor(rng() * 6), shade(theme.stoneDark, -15));
      }
      break;
    }
    case "city": {
      for (let i = 0; i < 5; i++) {
        const bw = 6 + Math.floor(rng() * 4);
        const bh = 10 + Math.floor(rng() * 9);
        const bx = 2 + i * 12;
        rect(ctx, bx, horizon - bh, bw, bh, theme.building);
        rect(ctx, bx, horizon - bh, bw, 1, theme.buildingDark);
        // windows
        for (let wy = horizon - bh + 2; wy < horizon - 1; wy += 3) {
          for (let wx = bx + 1; wx < bx + bw - 1; wx += 2) {
            if (rng() > 0.35) dot(ctx, wx, wy, theme.accent);
          }
        }
      }
      break;
    }
    case "laboratory": {
      // table + flasks
      rect(ctx, 22, horizon - 6, 20, 2, "#8a5a33");
      rect(ctx, 24, horizon - 4, 1, 4, "#6d4526");
      rect(ctx, 39, horizon - 4, 1, 4, "#6d4526");
      flask(ctx, 26, horizon - 6, "#54e0c7", rng);
      flask(ctx, 31, horizon - 6, "#ff6bd6", rng);
      flask(ctx, 36, horizon - 6, "#ffe066", rng);
      break;
    }
    case "river": {
      const ry = horizon + 3;
      rect(ctx, 0, ry, W, 5, "#3d7dd8");
      rect(ctx, 0, ry, W, 1, "#6ba3f0");
      for (let i = 0; i < 12; i++) {
        dot(ctx, Math.floor(rng() * W), ry + 1 + Math.floor(rng() * 3), "#bfe0ff");
      }
      break;
    }
  }
}

// ---- Scene helper shapes ----

function house(ctx: CanvasRenderingContext2D, x: number, y: number, theme: Theme, rng: () => number) {
  const w = 9, h = 6;
  rect(ctx, x, y - h, w, h, theme.building);
  rect(ctx, x, y - h, w, 1, theme.buildingDark);
  // roof
  for (let i = 0; i < 3; i++) rect(ctx, x - 1 + i, y - h - 3 + i, w + 2 - i * 2, 1, theme.roof);
  // door + window
  rect(ctx, x + 2, y - 3, 2, 3, "#6d4526");
  if (rng() > 0.3) dot(ctx, x + w - 3, y - h + 2, theme.accent);
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, theme: Theme) {
  rect(ctx, x + 1, y - 2, 1, 2, "#5d4037");
  for (let i = 0; i < 3; i++) {
    const w = 1 + i * 2;
    const ly = y - 3 - i * Math.floor(h / 3);
    rect(ctx, x + 1 - Math.floor(w / 2), ly - 1, w + 1, 2, i === 2 ? theme.tree : theme.treeDark);
  }
  rect(ctx, x, y - h, 3, 2, theme.tree);
}

function peak(ctx: CanvasRenderingContext2D, cx: number, baseY: number, h: number, color: string, snow: string, night?: boolean) {
  for (let r = 0; r < h; r++) {
    const w = Math.round((r / h) * 10) + 1;
    rect(ctx, cx - Math.floor(w / 2), baseY - h + r, w, 1, color);
  }
  // snow cap
  rect(ctx, cx - 1, baseY - h, 3, 1, night ? "#cfd8ff" : snow);
  dot(ctx, cx, baseY - h + 1, night ? "#cfd8ff" : snow);
}

function castle(ctx: CanvasRenderingContext2D, x: number, y: number, theme: Theme) {
  const w = 26, h = 12;
  rect(ctx, x, y - h, w, h, theme.building);
  rect(ctx, x, y - h, w, 1, theme.buildingDark);
  // towers
  for (const tx of [x - 2, x + w]) {
    rect(ctx, tx, y - h - 4, 4, h + 4, theme.stone);
    rect(ctx, tx, y - h - 5, 4, 1, theme.roof);
    for (let b = 0; b < 4; b += 2) dot(ctx, tx + b, y - h - 6, theme.roof);
  }
  // battlements
  for (let b = 0; b < w; b += 2) dot(ctx, x + b, y - h - 1, theme.stone);
  // gate + windows
  rect(ctx, x + w / 2 - 2, y - 4, 4, 4, "#3a2a1a");
  dot(ctx, x + 5, y - h + 3, theme.accent);
  dot(ctx, x + w - 6, y - h + 3, theme.accent);
  // flag
  rect(ctx, x + w / 2, y - h - 4, 1, 4, "#6d4526");
  rect(ctx, x + w / 2 + 1, y - h - 4, 3, 2, theme.roof);
}

function flask(ctx: CanvasRenderingContext2D, x: number, y: number, liquid: string, rng: () => number) {
  rect(ctx, x, y - 4, 3, 1, "#cfe8ef");       // rim
  rect(ctx, x + 1, y - 3, 1, 1, "#cfe8ef");   // neck
  rect(ctx, x, y - 2, 3, 2, "#cfe8ef");       // bulb glass
  rect(ctx, x, y - 1, 3, 1, liquid);          // liquid
  void rng;
}

// ---- Low-level pixel helpers ----

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function outlineRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  rect(ctx, x, y, w, 1, c);
  rect(ctx, x, y + h - 1, w, 1, c);
  rect(ctx, x, y, 1, h, c);
  rect(ctx, x + w - 1, y, 1, h, c);
}

function outlineBlobEdges(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  bottom: number,
  size: number,
  c: string
) {
  for (let y = top; y <= bottom; y++) {
    let left = -1, right = -1;
    for (let x = 0; x < size; x++) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      if (p[3] > 0) {
        if (left === -1) left = x;
        right = x;
      }
    }
    if (left !== -1) {
      dot(ctx, left, y, c);
      dot(ctx, right, y, c);
    }
  }
  // top/bottom outline
  for (let x = 0; x < size; x++) {
    const pt = ctx.getImageData(x, top, 1, 1).data;
    if (pt[3] > 0) { dot(ctx, x, top, c); break; }
  }
  for (let x = size - 1; x >= 0; x--) {
    const pt = ctx.getImageData(x, top, 1, 1).data;
    if (pt[3] > 0) { dot(ctx, x, top, c); break; }
  }
}

// shade: lighten (amt>0) / darken (amt<0) hex color
function shade(hex: string, amt: number): string {
  const n = hex.replace("#", "");
  const num = parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function rngSeedNoise(rng: () => number): number {
  return rng() * Math.PI * 2;
}

// ------------------------------------------------------------------------------
// BATTLE STAGE — สนามต่อสู้เต็มรูปแบบ (ฉากหลัง + Hero VS Enemy + HP bars)
// ------------------------------------------------------------------------------

export type BattlePhase = "idle" | "hero_attack" | "enemy_attack";

export function BattleStage({
  environment,
  seed,
  style,
  enemyName,
  enemyKind,
  enemyHpRatio,
  playerHpRatio,
  phase = "idle",
  defeated = false,
}: {
  environment: string;
  seed: string;
  style?: string;
  enemyName: string;
  enemyKind: "enemy" | "boss";
  /** 0..1 */
  enemyHpRatio: number;
  playerHpRatio: number;
  phase?: BattlePhase;
  /** enemy กำลังโดนกำจัด (animation) */
  defeated?: boolean;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-slate-700/80">
      {/* ฉากหลัง animated (responsive เต็มความกว้าง) */}
      <PixelScene
        environment={environment}
        seed={seed}
        style={style}
        animated
      />

      {/* Vignette ให้ตัวละครเด่น */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(5,8,20,0.55)_100%)]" />

      {/* HERO — ซ้าย */}
      <div className="absolute bottom-[6%] left-[10%] flex flex-col items-center gap-1.5">
        <span className={phase === "hero_attack" ? "eq-lunge-right inline-block" : "eq-float-idle inline-block"}>
          <PixelSprite kind="hero" seed="player-hero" style={style} size={72} floating />
        </span>
        <div className="w-24 rounded-full border border-slate-950/70 bg-slate-950/70 p-0.5 backdrop-blur-sm">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                playerHpRatio > 0.3 ? "bg-gradient-to-r from-emerald-400 to-teal-400" : "bg-gradient-to-r from-rose-500 to-red-500"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, playerHpRatio * 100))}%` }}
            />
          </div>
        </div>
        <p className="rounded bg-slate-950/70 px-2 py-0.5 text-[11px] font-bold text-emerald-300 backdrop-blur-sm">
          YOU · {Math.round(playerHpRatio * 100)}%
        </p>
      </div>

      {/* ENEMY — ขวา */}
      <div className="absolute bottom-[6%] right-[10%] flex flex-col items-center gap-1.5">
        <span
          className={`${phase === "enemy_attack" ? "eq-lunge-left inline-block" : "eq-float-idle inline-block"} ${
            defeated ? "eq-defeat" : ""
          } relative`}
        >
          <PixelSprite kind={enemyKind} seed={enemyName} style={style} size={enemyKind === "boss" ? 96 : 84} floating />
          {phase === "hero_attack" && (
            <span className="eq-hit-flash absolute inset-0 bg-white/80 mix-blend-overlay" />
          )}
        </span>
        <div className="w-28 rounded-full border border-slate-950/70 bg-slate-950/70 p-0.5 backdrop-blur-sm">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-rose-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, enemyHpRatio * 100))}%` }}
            />
          </div>
        </div>
        <p className="max-w-40 truncate rounded bg-slate-950/70 px-2 py-0.5 text-[11px] font-bold text-rose-300 backdrop-blur-sm">
          {enemyKind === "boss" ? "👑 " : "👾 "}
          {enemyName}
        </p>
      </div>

      {/* VS badge */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-white/20 bg-slate-950/60 px-4 py-1 text-xs font-black tracking-widest text-white/90 backdrop-blur-sm">
        ⚔️ BATTLE
      </div>
    </div>
  );
}

