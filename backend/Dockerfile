# EduQuest AI — Backend (FastAPI) production image
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Tesseract OCR (ไทย + อังกฤษ) สำหรับ PDF ภาพสแกน
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-tha \
    tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# โฟลเดอร์ runtime (Render disk เป็น ephemeral — ไฟล์อัปโหลดจะหายเมื่อ restart)
RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
