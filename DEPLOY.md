# 🚀 EduQuest AI — Deployment Guide (Ver 2.0 — Gamification + Bugfixes)

เป้าหมาย: มีลิงก์จริงให้คนอื่นเข้าใช้ได้ โดยไม่ต้องรันบน localhost

```
Frontend (Vercel)  →  https://your-app.vercel.app
Backend  (Render)  →  https://eduquest-api.onrender.com
Database (Neon)    →  Postgres cloud
```

---

## 📋 สิ่งที่เปลี่ยนในเวอร์ชันนี้ (Phase 2 Gamification)

| ฟีเจอร์ | รายละเอียด |
|---|---|
| 🔥 Streak | นับวันเล่นติดต่อกัน, longest streak, streak_increased แจ้งเมื่อเพิ่งต่อ streak |
| 🏆 Badge | เหรียญตราต่อคอร์ส, เก็บใน `user_badges`, กันซ้ำ, คืน badge ที่ได้ใหม่ใน response |
| ❓ คำถามใหม่ | True/False, Matching (จับคู่), Ordering (เรียงลำดับ) นอกจาก multiple-choice เดิม |
| ⏱️ ความยาวเกม | short (5 บท) / medium (10 บท) / long (15 บท) — ปรับได้ตอนสร้างคอร์ส |
| 🤖 AI เช็คเนื้อหา | ตรวจว่าบทเรียนพอต่อความยาวที่เลือกไหม ก่อนสร้างเกมจริง |
| 🐛 Bugfix | สร้าง `models/__init__.py` (backend import ไม่ได้หากไม่มี), เพิ่ม migration streak columns + `user_badges` table |

---

## ⚠️ ข้อจำกัดสำคัญ (อ่านก่อน deploy)

**ผม (AI) ไม่สามารถ deploy หรือส่งลิงก์ให้คุณได้** เนื่องจาก:
- ไม่มีสิทธิ์เข้าบัญชี Render / Vercel / Neon / GitHub ของคุณ
- ไม่สามารถรันคำสั่ง deploy บนเซิร์ฟเวอร์ของคุณได้

คุณต้อง **รัน deploy เอง** ตามขั้นตอนด้านล่าง แล้วแจ้งลิงก์ที่ได้มาให้ผมตรวจต่อได้

---

## STEP 0 — Push โค้ดขึ้น GitHub

```powershell
# ตรวจว่าไฟล์ใหม่ถูกเพิ่มหมดแล้ว
git status

git add .
git commit -m "feat: Phase 2 gamification + bugfixes (models/__init__.py, user_badges, streak)"
git push origin main
```

> ⚠️ **ห้าม commit `.env`** — `.gitignore` กันไว้แล้ว แต่ตรวจอีกที ก่อน push

---

## STEP 1 — Database (Neon) ~3 นาที

1. ไปที่ https://neon.tech → Sign up (ใช้ GitHub ได้)
2. Create Project → ตั้งชื่อ `eduquest`
3. Copy **Connection string** (รูปแบบ `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
4. **แก้ให้เป็น asyncpg**: เปลี่ยน `postgresql://` → `postgresql+asyncpg://` และเติม `?ssl=require`
5. เก็บค่านี้ไว้ = `DATABASE_URL`

ตัวอย่างที่ถูก:
```
postgresql+asyncpg://neondb_owner:xxx@ep-xxx.neon.tech/neondb?ssl=require
```

---

## STEP 2 — Backend (Render) ~5 นาที

### วิธี A: Render Blueprint (แนะนำ)
1. https://render.com → Sign up → **New +** → **Blueprint** → เลือก repo
2. Render จะอ่าน `render.yaml` ให้เอง
3. กรอก Environment Variables (`sync: false`):
   - `DATABASE_URL` = ค่าจาก Step 1
   - `DEEPSEEK_API_KEY` = key ของคุณ
   - `CORS_ORIGINS` = `https://placeholder.vercel.app` (แก้ทีหลังใน Step 4)
4. กด **Create Service** → รอ build (~3-5 นาที)
5. ทดสอบ: เปิด `https://eduquest-api.onrender.com/` → ต้องเห็น JSON `{"message":"EduQuest AI is running",...}`

### วิธี B: Web Service แยก
1. Render → **New +** → **Web Service** → เลือก repo → Root Directory: `backend`
2. Runtime: Python, Build: `pip install -r requirements.txt`, Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. เพิ่ม env vars เดียวกับวิธี A

จด URL backend ไว้ = `https://<service-name>.onrender.com`

---

## STEP 3 — Frontend (Vercel) ~3 นาที

1. https://vercel.com → Add New → **Project** → import repo
2. Framework Preset: **Next.js** (auto-detect)
3. Root Directory: `frontend`
4. Environment Variable:
   - `NEXT_PUBLIC_API_URL` = `https://eduquest-api.onrender.com` (จาก Step 2)
5. **Deploy** → ได้ลิงก์ `https://xxxx.vercel.app`

---

## STEP 4 — เชื่อม CORS กลับ (สำคัญมาก!)

กลับไปที่ Render → eduquest-api → **Environment**:
- แก้ `CORS_ORIGINS` = `https://xxxx.vercel.app` (ลิงก์จริงจาก Step 3)
- Save → service จะ restart เอง

ถ้าไม่แก้ CORS frontend จะเรียก API ไม่ได้ ( error 403 / CORS blocked)

---

## STEP 5 — ทดสอบ End-to-End ✅

1. เปิด `https://xxxx.vercel.app/login` → **🎮 Demo Account** (หรือสมัครใหม่)
2. **+ Create Game** → ใส่ไฟล์บทเรียน → ตั้งค่าเกม (ความยาว + ประเภทคำถาม) → **🔍 ให้ AI ตรวจสอบเนื้อหา** → **✨ สร้างเกมด้วย AI เลย!**
3. เข้าเล่นเกม → ตอบคำถามหลายประเภท (เลือกข้อ, จริง/เท็จ, จับคู่, เรียงลำดับ) → จบ chapter → เห็น streak + badge
4. กลับ Dashboard → **🌐 Publish** → Share Modal (Copy Link / QR)
5. ส่งลิงก์ `/play/{token}` ให้คนอื่นเปิดจากมือถือ → เล่นได้ทันที (Guest mode, ไม่ต้องสมัคร)

---

## STEP 6 — Keep-alive (กัน Render free plan หลับ)

มีไฟล์ `.github/workflows/keepalive.yml` แล้ว → commit + push → GitHub Actions จะ ping backend ทุก 10 นาที

ถ้าไม่มี ให้สร้างไฟล์ `.github/workflows/keepalive.yml`:
```yaml
name: Keepalive
on:
  schedule:
    - cron: "*/10 * * * *"
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping backend
        run: |
          curl -s https://eduquest-api.onrender.com/ || true
```

---

## ❓ Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| Backend เปิดครั้งแรกช้า 30-60 วิ | Free tier sleep — request แรก cold start |
| CORS error ใน console | `CORS_ORIGINS` ยังไม่ตรงกับ domain Vercel |
| "AI สร้างไม่สำเร็จ" | เช็ค `DEEPSEEK_API_KEY` ใน Render Logs |
| Upload PDF แล้ว fail | ไฟล์ >25MB หรือ OCR timeout — ลองไฟล์เล็กลง |
| ลืม token share | Dashboard → Publish ซ้ำ (idempotent ได้ token เดิม) |
| Backend เริ่มต้นไม่ได้ (ImportError) | ตรวจว่ามี `backend/models/__init__.py` — ถ้าไม่มี ให้สร้างไฟล์ว่างแล้ว push ใหม่ |
| Streak / Badge ไม่แสดง | ตรวจว่า migration รันแล้ว — เปิด Render Shell → `psql $DATABASE_URL -c "\dt users user_badges"` |

---

## 🏠 Local Development

```
เปิด   : Docker Desktop → เปิด container Postgres แล้วรัน backend: uvicorn main:app --reload
        frontend: npm run dev (http://localhost:3000)
```

---

## 🔗 หลัง deploy เสร็จ

แจ้งลิงก์ frontend (Vercel) ให้ผมตรวจความถูกต้องต่อได้ครับ