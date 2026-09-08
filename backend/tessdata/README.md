# Tesseract OCR Language Data

โฟลเดอร์นี้เก็บไฟล์ `.traineddata` สำหรับ Tesseract OCR (ใช้กับ PDF ภาพสแกน)
ไฟล์เหล่านี้ **ไม่ถูก commit** (binary ขนาดใหญ่) — ติดตั้งเองตามนี้:

## การติดตั้ง

1. ติดตั้ง Tesseract:
   ```powershell
   winget install --id UB-Mannheim.TesseractOCR -e
   ```

2. ดาวน์โหลด language data มาใส่โฟลเดอร์นี้ (`backend/tessdata/`):
   ```powershell
   $base = "https://github.com/tesseract-ocr/tessdata_fast/raw/main"
   Invoke-WebRequest "$base/tha.traineddata" -OutFile "tha.traineddata"
   Copy-Item "C:\Program Files\Tesseract-OCR\tessdata\eng.traineddata" .
   Copy-Item "C:\Program Files\Tesseract-OCR\tessdata\osd.traineddata" .
   ```

3. ติดตั้ง Python package:
   ```powershell
   pip install pytesseract
   ```

หมายเหตุ: ระบบ fallback อัตโนมัติ — ถ้า PDF มีข้อความฝังอยู่จะไม่ใช้ OCR เลย (เร็วมาก)
OCR จะทำงานเฉพาะ PDF ภาพสแกน และจำกัดไม่เกิน 40 หน้าแรก
