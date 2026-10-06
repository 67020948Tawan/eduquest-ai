# 🚀 EduQuest AI — Deployment Guide (Ver 1.0)

เป้าหมาย: มีลิงก์จริงให้คนอื่นเข้าใช้ได้ โดยไม่ต้องรันบน localhost

```
Frontend (Vercel)  →  https://your-app.vercel.app
Backend  (Render)  →  https://eduquest-api.onrender.com
Database (Neon)    →  Postgres cloud
```

### ✅ สถานะ deploy จริง (อัปเดต 6 ต.ค. 2026)

| ส่วน | URL / ที่อยู่ | หมายเหตุ |
|---|---|---|
| Frontend | `https://frontend-olive-nine-n2kgq6d5zd.vercel.app` | Vercel ทีม `tawan3` — env `NEXT_PUBLIC_API_URL` ชี้ Render |
| Backend | `https://eduquest-api-natl.onrender.com` | Render free plan (Singapore) — auto-deploy เมื่อ push ลง `main` |
| Database | Neon `eduquest-ai` (pooler) | `DATABASE_URL` ต้องใช้ `postgresql+asyncpg://...?ssl=require` |
| Keep-alive | `.github/workflows/keepalive.yml` | ping ทุก 10 นาที กัน free plan หลับ |
| Repo แบบเก่า | `frontend-mikuo.vercel.app` (ทีม mikuo) | เจ้าของเดิมเลิกใช้ / เข้าไม่ถึงแล้ว |

- CORS ตั้งผ่าน env `CORS_ORIGINS` บน Render (คั่นด้วย `,`) — เพิ่ม domain ใหม่ทุกครั้งที่เปลี่ยนโดเมน แล้ว redeploy
- Deploy frontend จาก local: อยู่ในโฟลเดอร์ `frontend` แล้ว `npx vercel deploy --prod --yes --token <TOKEN>`
- ส่วน GitHub auto-deploy ฝั่ง frontend ต้อง grant repo ให้แอป Vercel ก่อน (ยังไม่ได้เปิด)

---

## STEP 0 — Push โค้ดขึ้น GitHub

```bash
git add .
git commit -m "EduQuest AI v1.0"
git push origin main
```

> ⚠️ ตรวจว่า `.env` **ไม่ถูก commit** (`.gitignore` กันไว้แล้ว) — key จริงใส่ใน Dashboard ของแต่ละ platform เท่านั้น

---

## STEP 1 — Database (Neon) ~3 นาที

1. ไปที่ https://neon.tech → Sign up (ใช้ GitHub ได้)
2. Create Project → ตั้งชื่อ `eduquest`
3. Copy **Connection string** (รูปแบบ `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
4. **แก้ให้เป็น asyncpg**: เปลี่ยน `postgresql://` → `postgresql+asyncpg://`

เก็บไว้ = `DATABASE_URL`

---

## STEP 2 — Backend (Render) ~5 นาที

1. https://render.com → Sign up → **New +** → **Blueprint** → เลือก repo
   (Render จะอ่าน `render.yaml` ให้เอง)
2. กรอก Environment Variables ที่ mark `sync: false`:
   - `DATABASE_URL` = ค่าจาก Step 1
   - `DEEPSEEK_API_KEY` = key ของคุณ
   - `CORS_ORIGINS` = ใส่ค่าชั่วคราวก่อน `https://placeholder.vercel.app` (มาแก้ใน Step 3)
3. กด **Create Service** → รอ build (~3-5 นาที)
4. ทดสอบ: เปิด `https://eduquest-api.onrender.com/` → ต้องเห็น JSON

> 💡 Backend URL จะเป็น `https://<service-name>.onrender.com` — จดไว้

---

## STEP 3 — Frontend (Vercel) ~3 นาที

1. https://vercel.com → Add New → **Project** → import repo
2. Framework Preset: **Next.js** (auto-detect)
3. Root Directory: `frontend`
4. Environment Variable:
   - `NEXT_PUBLIC_API_URL` = `https://eduquest-api.onrender.com` (จาก Step 2)
5. **Deploy** → ได้ลิงก์ `https://xxxx.vercel.app`

---

## STEP 4 — เชื่อม CORS กลับ (สำคัญ!)

กลับไปที่ Render → eduquest-api → **Environment**:
- แก้ `CORS_ORIGINS` = `https://xxxx.vercel.app` (ลิงก์จริงจาก Step 3)

→ Save → service จะ restart เอง

---

## STEP 5 — ทดสอบ End-to-End ✅

1. เปิด `https://xxxx.vercel.app/login` → **🎮 Demo Account**
2. **+ Create Game** → ใส่ไฟล์ → เลือกโหมด → **✨ สร้างเกมเลย!**
3. เข้าเล่นเกม / กลับ Dashboard → **🌐 Publish** → Share Modal (Copy Link / QR)
4. ส่งลิงก์ `/play/{token}` ให้คนอื่นเปิดจากมือถือ → เล่นได้ทันที (Guest mode)

---

## ❓ Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| Backend เปิดครั้งแรกช้า 30-60 วิ | Free tier sleep — request แรก cold start |
| CORS error ใน console | `CORS_ORIGINS` ยังไม่ตรงกับ domain Vercel |
| "AI สร้างไม่สำเร็จ" | เช็ค DEEPSEEK_API_KEY ใน Render Logs |
| Upload PDF แล้ว fail | ไฟล์ >25MB หรือ OCR timeout — ลองไฟล์เล็กลง |
| ลืม token share | Dashboard → Publish ซ้ำ (idempotent ได้ token เดิม) |

---

## 🏠 Local Development (จำไว้)

```
เปิด   : Docker Desktop → START.bat
ปิด    : STOP.bat
```
