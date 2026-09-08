"use client";

// ==============================================================================
// BaseCanvas v2 — Live Base View (128x72 · building scale ×2)
//
// • อาคารชัดเจนขึ้น (×2) บนลานหินแต่ละ plot + รั้ว + ต้นไม้ + ดอกไม้
// • Idle animation ต่ออาคาร (ควัน/ข้าวโยก/ประกาย/ธง/คบเพลิง)
// • Bubble 💰×12 ลอยเหนืออาคารเมื่อมีผลผลิตรอเก็บ
// • 👹 Raid: สัตว์ประหลาดเดินเข้ามา + กรอบแดงกระพริบ
// • Workers เดินบนถนน + production popups + นก
// ==============================================================================

import { useEffect, useRef } from "react";
import { drawBuilding, getTheme, hashString, mulberry32 } from "@/components/PixelArt";

const W = 128;
const H = 72;
const SKY_H = 26;
const PATH_Y = 58;

const PLOTS: Record<string, { x: number; y: number }> = {
  house: { x: 22, y: 66 },
  farm: { x: 54, y: 66 },
  mine: { x: 86, y: 66 },
  workshop: { x: 114, y: 66 },
  library: { x: 34, y: 44 },
  academy: { x: 66, y: 44 },
  castle: { x: 98, y: 44 },
};

const YIELD_ICON: Record<string, string> = {
  farm: "💰",
  mine: "🪨",
  workshop: "🪵",
  library: "📖",
  academy: "📖",
  house: "💰",
};

export default function BaseCanvas({
  buildings,
  style,
  pendingByBuilding = {},
  raidName = null,
}: {
  buildings: string[];
  style?: string;
  /** {buildingId: {gold: 12}} — bubble เหนืออาคาร */
  pendingByBuilding?: Record<string, Record<string, number>>;
  /** ชื่อผู้บุก (raid active) */
  raidName?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buildingsKey = buildings.join(",");
  const pendingKey = JSON.stringify(pendingByBuilding);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const theme = getTheme(style);
    const built = buildingsKey ? buildingsKey.split(",") : [];
    const pendingMap: Record<string, Record<string, number>> = JSON.parse(pendingKey || "{}");

    // ---------- Static terrain ----------
    const base = document.createElement("canvas");
    base.width = W;
    base.height = H;
    const b = base.getContext("2d");
    if (!b) return;

    const rngT = mulberry32(hashString(`${style}|terrain-v2`));
    const dot = (x: number, y: number, c: string) => {
      b.fillStyle = c;
      b.fillRect(Math.round(x), Math.round(y), 1, 1);
    };
    const rect = (x: number, y: number, w: number, h: number, c: string) => {
      b.fillStyle = c;
      b.fillRect(Math.round(x), Math.round(y), w, h);
    };

    // Sky gradient bands
    theme.sky.forEach((c, i) =>
      rect(0, (i * SKY_H) / theme.sky.length, W, SKY_H / theme.sky.length + 1, c)
    );
    if (theme.night) {
      for (let i = 0; i < 20; i++) dot(rngT() * W, rngT() * (SKY_H - 5), "#e6f0ff");
      // moon
      rect(104, 4, 5, 5, "#e8e8ff");
      rect(103, 5, 1, 3, "#c5c5e8");
      rect(109, 5, 1, 3, "#c5c5e8");
    }

    // Hills layer
    for (let x = 0; x < W; x++) {
      const h = 4 + Math.round(Math.sin(x * 0.15 + 2) * 2.4);
      rect(x, SKY_H - h, 1, h + 1, theme.treeDark);
    }

    // Grass
    rect(0, SKY_H - 1, W, H - SKY_H + 1, theme.ground);
    for (let i = 0; i < 150; i++) {
      dot(rngT() * W, SKY_H + 2 + rngT() * (H - SKY_H - 3), theme.groundDark);
    }
    // Flowers
    const flowerCols = ["#ff8fab", "#ffd75e", "#b39ddb", "#80deea"];
    for (let i = 0; i < 14; i++) {
      dot(3 + rngT() * (W - 6), SKY_H + 4 + rngT() * (H - SKY_H - 8), flowerCols[i % flowerCols.length]);
    }

    // Background trees (ซ้าย/ขวาบน)
    const treeAt = (tx: number, ty: number, s: number) => {
      rect(tx, ty + s - 3, 2, 3, "#5d4037");
      rect(tx - s / 2, ty, s + 1, s - 2, theme.treeDark);
      rect(tx - s / 2 + 1, ty - 3, s - 1, 3, theme.tree);
      rect(tx - s / 2 + 2, ty - 6, s - 3, 3, theme.tree);
    };
    treeAt(8, 30, 8);
    treeAt(120, 28, 7);
    treeAt(116, 33, 5);

    // Road
    rect(0, PATH_Y, W, 7, "#b08d57");
    rect(0, PATH_Y, W, 1, "#d4b483");
    rect(0, PATH_Y + 6, W, 1, "#8d6e4a");
    for (let i = 0; i < 40; i++) dot(rngT() * W, PATH_Y + 1 + rngT() * 5, "#a07b4e");

    // Fence ข้างถนน
    for (let fx = 4; fx < W - 4; fx += 10) {
      rect(fx, PATH_Y - 3, 1, 3, "#795548");
      rect(fx + 4, PATH_Y - 3, 1, 3, "#795548");
      rect(fx, PATH_Y - 2, 5, 1, "#8d6e4a");
    }

    // Plots: plaza stone + ghost/sign
    for (const [id, p] of Object.entries(PLOTS)) {
      // plaza
      rect(p.x - 19, p.y - 1, 38, 11, "#98a0ae");
      rect(p.x - 19, p.y - 1, 38, 1, "#b6bec9");
      for (let gx = 0; gx < 38; gx += 6) rect(p.x - 19 + gx, p.y + 4, 5, 1, "#7d8494");

      if (built.includes(id)) continue;
      // ghost silhouette
      b.save();
      b.globalAlpha = 0.18;
      b.translate(Math.round(p.x - 16), Math.round(p.y - 32));
      b.scale(2, 2);
      drawBuilding(b, mulberry32(hashString(`bld|${style}|${id}`)), theme, id);
      b.restore();
      b.globalAlpha = 1;
      // ป้าย
      rect(p.x - 4, p.y - 12, 2, 6, "#795548");
      rect(p.x - 7, p.y - 17, 8, 5, "#c9a86f");
      rect(p.x - 7, p.y - 17, 8, 1, "#8d6e4a");
      dot(p.x - 3, p.y - 15, "#795548");
      dot(p.x - 1, p.y - 15, "#795548");
    }

    // Built buildings (scale ×2)
    for (const id of built) {
      const p = PLOTS[id];
      if (!p) continue;
      b.save();
      b.translate(Math.round(p.x - 16), Math.round(p.y - 32));
      b.scale(2, 2);
      drawBuilding(b, mulberry32(hashString(`bld|${style}|${id}`)), theme, id);
      b.restore();
      // shadow
      b.fillStyle = "rgba(0,0,0,0.28)";
      b.fillRect(p.x - 16, p.y, 33, 2);
    }

    ctx.imageSmoothingEnabled = false;

    // ---------- Dynamic ----------
    interface Worker { x: number; dir: number; speed: number; state: "walk" | "work"; timer: number; targetX: number; cloth: string; skin: string }
    interface Popup { x: number; y: number; text: string; life: number }
    interface Smoke { x: number; y: number; life: number }

    const workers: Worker[] = [];
    const nWorkers = Math.min(5, Math.max(2, built.length));
    for (let i = 0; i < nWorkers; i++) {
      workers.push({
        x: 8 + ((W - 16) / nWorkers) * i + rngT() * 6,
        dir: i % 2 === 0 ? 1 : -1,
        speed: 0.09 + Math.random() * 0.05,
        state: "walk",
        timer: 60 + Math.random() * 140,
        targetX: 20 + Math.random() * (W - 40),
        cloth: theme.cloth[(i + 1) % theme.cloth.length],
        skin: theme.skin[i % theme.skin.length],
      });
    }
    const popups: Popup[] = [];
    const smokes: Smoke[] = [];

    // raid marcher position
    let beastX = W + 14;

    let raf = 0;
    let frame = 0;
    let last = 0;

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (ts - last < 50) return;
      last = ts;
      frame++;

      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);

      const nowPending = pendingMap; // snapshot จาก prop ล่าสุดของ effect run นี้

      // ---------- Building animations ----------
      for (const id of built) {
        const p = PLOTS[id];
        if (!p) continue;
        const ax = p.x - 16; // top-left ของ sprite ก่อน scale
        const ay = p.y - 32;
        const S = 2; // scale

        const put = (x: number, y: number, c: string) => {
          ctx.fillStyle = c;
          ctx.fillRect(Math.round(ax + x * S), Math.round(ay + y * S), S, S);
        };

        if (id === "house" || id === "workshop") {
          if (frame % 55 === 0) smokes.push({ x: ax + (id === "house" ? 9 : 25), y: ay + 4, life: 70 });
        }
        if (id === "farm") {
          const sway = Math.sin(frame * 0.09) > 0 ? S : 0;
          for (let i = 0; i < 5; i++) {
            put(3 + i * 2.5 + sway / 2, 9 - (i % 2), "#aed581");
          }
        }
        if (id === "mine" && frame % 30 < 6) {
          put(7, 11, frame % 10 < 5 ? "#ffd75e" : "#ffab40");
        }
        if (id === "workshop" && frame % 100 < 8) {
          put(6, 10, "#ffe082");
          put(5 + (frame % 4), 9, "#fff59d");
        }
        if (id === "library" && Math.sin(frame * 0.03) > -0.2) {
          put(8, 7, "#ffd75e");
        }
        if (id === "academy") {
          const wave = Math.sin(frame * 0.12) > 0 ? S : 0;
          put(8, 1 + wave / S, theme.roof);
          put(9, 2 + wave / S, theme.roof);
          if (frame % 160 < 20) put(8 + wave / S, 4, theme.accent);
        }
        if (id === "castle") {
          const f = frame % 12;
          put(8, 9, f < 6 ? "#ff9800" : "#ffc107");
          put(7, 8, f < 4 ? "#ff5722" : "#ff9800");
          put(9, 8, f < 8 ? "#ffeb3b" : "#ff9800");
          const wv = Math.sin(frame * 0.1) > 0 ? 1 : 0;
          put(3, 3 + wv, theme.roof);
        }

        // Pending bubble
        const pend = nowPending[id];
        if (pend && Object.values(pend).some((v) => (v ?? 0) > 0)) {
          const entries = Object.entries(pend);
          const [firstRes, firstAmt] = entries[0];
          const icon = RESOURCE_ICON[firstRes] ?? "📦";
          const bounce = Math.abs(Math.sin(frame * 0.13)) * -4;
          const bx = p.x;
          const by = ay - 8 + bounce;
          ctx.fillStyle = "rgba(15,23,42,0.88)";
          ctx.beginPath();
          ctx.arc(bx, by, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(148,163,184,0.7)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`${icon}${firstAmt}`, bx, by + 1);
          if (entries.length > 1) {
            ctx.font = "6px sans-serif";
            ctx.fillText("+", bx + 12, by + 4);
          }
        }
      }

      // Smoke
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life--;
        s.y -= 0.14;
        s.x += Math.sin(frame * 0.05 + s.life) * 0.1;
        const a = Math.max(0, s.life / 70) * 0.55;
        ctx.fillStyle = `rgba(205,205,215,${a.toFixed(2)})`;
        const size = s.life > 35 ? 2 : 3;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), size, size);
        if (s.life <= 0) smokes.splice(i, 1);
      }

      // ---------- Workers ----------
      for (const wk of workers) {
        wk.timer--;
        if (wk.state === "walk") {
          wk.x += wk.dir * wk.speed * 2;
          const arrived =
            (wk.dir === 1 && wk.x >= wk.targetX) || (wk.dir === -1 && wk.x <= wk.targetX);
          if (arrived) {
            wk.state = "work";
            wk.timer = 90 + Math.random() * 80;
          }
          if (wk.x < 4 || wk.x > W - 4) wk.dir *= -1 as 1 | -1;
        } else if (wk.timer <= 0) {
          wk.state = "walk";
          wk.targetX = 8 + Math.random() * (W - 16);
          wk.dir = wk.targetX > wk.x ? 1 : -1;
        }

        const bob = wk.state === "walk" && frame % 14 < 7 ? 1 : 0;
        const wx = Math.round(wk.x);
        const wy = PATH_Y + 6;
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(wx - 2, wy, 4, 1);
        ctx.fillStyle = theme.outline;
        if (bob) {
          ctx.fillRect(wx - 2, wy - 5, 2, 5);
          ctx.fillRect(wx, wy - 4, 2, 4);
        } else {
          ctx.fillRect(wx - 2, wy - 4, 2, 4);
          ctx.fillRect(wx, wy - 4, 2, 4);
        }
        ctx.fillStyle = wk.cloth;
        ctx.fillRect(wx - 2, wy - 11, 4, 7 - bob);
        ctx.fillStyle = wk.skin;
        ctx.fillRect(wx - 2, wy - 16, 4, 5);
        if (wk.state === "work" && frame % 24 < 12) {
          ctx.fillStyle = "#90a4ae";
          ctx.fillRect(wx + (wk.dir === 1 ? 3 : -5), wy - 14, 2, 5);
          ctx.fillStyle = "#5d4037";
          ctx.fillRect(wx + (wk.dir === 1 ? 3 : -5), wy - 16, 2, 2);
        }
      }

      // ---------- Popups ----------
      if (frame % 140 === 0 && built.length > 0) {
        const producers = built.filter((id) => YIELD_ICON[id]);
        if (producers.length > 0) {
          const id = producers[Math.floor(frame / 140) % producers.length];
          const p = PLOTS[id];
          popups.push({ x: p.x, y: p.y - 36, text: YIELD_ICON[id], life: 65 });
        }
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        const pp = popups[i];
        pp.life--;
        pp.y -= 0.3;
        ctx.globalAlpha = Math.max(0, Math.min(1, pp.life / 40));
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(pp.text, pp.x, pp.y);
        ctx.globalAlpha = 1;
        if (pp.life <= 0) popups.splice(i, 1);
      }

      // ---------- Raid marcher ----------
      if (raidName) {
        if (beastX > 46) beastX -= 0.35;
        const bob = frame % 12 < 6 ? 1 : 0;
        const bx = Math.round(beastX);
        const by = PATH_Y + 7;
        // shadow
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(bx - 6, by, 14, 2);
        // body blob
        for (let yy = 0; yy < 10; yy++) {
          const hw = [3, 5, 6, 7, 7, 7, 6, 5, 3, 2][yy] + (yy % 2 === bob ? 0 : 1);
          for (let dx = -hw; dx <= hw; dx++) {
            ctx.fillStyle = dx === -hw || dx === hw ? "#7f1d1d" : "#dc2626";
            ctx.fillRect(bx + dx, by - 12 + yy, 1, 1);
          }
        }
        // horns
        ctx.fillStyle = "#fecaca";
        ctx.fillRect(bx - 5, by - 15, 2, 2);
        ctx.fillRect(bx + 3, by - 15, 2, 2);
        // eyes
        ctx.fillStyle = "#fef08a";
        ctx.fillRect(bx - 3, by - 10, 2, 2);
        ctx.fillRect(bx + 1, by - 10, 2, 2);
        ctx.fillStyle = "#111";
        ctx.fillRect(bx - 3, by - 9, 1, 1);
        ctx.fillRect(bx + 2, by - 9, 1, 1);
        // teeth
        ctx.fillStyle = "#fff";
        ctx.fillRect(bx - 2, by - 6, 1, 2);
        ctx.fillRect(bx + 1, by - 6, 1, 2);

        // ❗ bubble
        const bb = Math.abs(Math.sin(frame * 0.2)) * -3;
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(220,38,38,0.95)";
        ctx.fillText("❗", bx, by - 20 + bb);

        // red vignette pulse
        const va = 0.12 + Math.sin(frame * 0.08) * 0.08;
        ctx.strokeStyle = `rgba(220,38,38,${va.toFixed(2)})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(0, 0, W, H);
      }

      // ---------- Birds ----------
      if (frame % 700 < 260) {
        const bx = ((frame % 700) / 260) * (W + 20) - 10;
        const by = 5 + Math.sin(frame * 0.05) * 2;
        const flap = frame % 16 < 8 ? 0 : 1;
        ctx.fillStyle = theme.night ? "#aab4d4" : "#37474f";
        ctx.fillRect(Math.round(bx), Math.round(by) - flap, 1, 1);
        ctx.fillRect(Math.round(bx) + 2, Math.round(by) - flap, 1, 1);
        ctx.fillRect(Math.round(bx) + 1, Math.round(by), 1, 1);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingsKey, pendingKey, style]);

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-slate-700 shadow-xl shadow-slate-950/50">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: "100%", height: "auto", imageRendering: "pixelated", display: "block" }}
        aria-label="Base view"
      />
      <div className="absolute left-2 top-2 rounded-lg bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-emerald-300 backdrop-blur-sm">
        🏰 YOUR BASE · LIVE
      </div>
      {raidName && (
        <div className="absolute right-2 top-2 animate-pulse rounded-lg bg-rose-700/90 px-2.5 py-1 text-[11px] font-black text-white backdrop-blur-sm">
          👹 UNDER ATTACK!
        </div>
      )}
      {buildings.length === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-slate-950/45">
          <p className="rounded-xl bg-slate-950/80 px-4 py-2 text-sm font-semibold text-slate-200 backdrop-blur">
            🏗️ เลือกอาคารด้านล่างเพื่อเริ่มสร้างฐาน
          </p>
        </div>
      )}
    </div>
  );
}

const RESOURCE_ICON: Record<string, string> = {
  gold: "💰",
  wood: "🪵",
  stone: "🪨",
  crystal: "💎",
  knowledge: "📖",
};
