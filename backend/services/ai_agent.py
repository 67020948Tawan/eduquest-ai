import os
import json
from dotenv import load_dotenv
from openai import AsyncOpenAI

# ตรวจสอบด้วยว่า schemas.generation ถูกต้องตามโปรเจกต์ของคุณ
from schemas.generation import CourseGenerationAI

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

# ใช้ AsyncOpenAI เพื่อการดึงข้อมูลที่ไม่บล็อกเซิร์ฟเวอร์
client = AsyncOpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url="https://api.deepseek.com"
)

MODEL_NAME = "deepseek-chat"

async def analyze_file_with_gemini(file_path: str, mime_type: str) -> dict:
    """
    วิเคราะห์ไฟล์เอกสารเพื่อหา Topic และรายละเอียดเบื้องต้น (ขับเคลื่อนโดย DeepSeek)
    """
    try:
        print(f"📄 [DeepSeek] Reading file for analysis: {file_path}")
        
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            file_content = f.read()

        prompt = f"""
        คุณคือ Content Analyzer AI ผู้เชี่ยวชาญด้านการศึกษา
        จงอ่านเนื้อหาจากเอกสารนี้อย่างละเอียด:
        {file_content[:15000]}

        สกัดใจความสำคัญ หัวข้อหลัก และวัตถุประสงค์การเรียนรู้
        และส่งผลลัพธ์กลับมาเป็นรูปแบบ JSON เท่านั้น โดยมีโครงสร้างดังนี้:
        {{
          "topics": ["หัวข้อที่ 1", "หัวข้อที่ 2", "หัวข้อที่ 3"],
          "learning_objectives": ["วัตถุประสงค์ 1", "วัตถุประสงค์ 2"],
          "difficulty": "beginner หรือ intermediate หรือ advanced",
          "summary": "สรุปใจความสำคัญของเอกสารนี้สั้นๆ"
        }}
        """

        response = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful education assistant that outputs only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    except Exception as e:
        print(f"❌ [DeepSeek] Content Analyzer Error: {e}")
        return {"error": f"AI ไม่สามารถประมวลผลไฟล์นี้ได้: {str(e)}"}


async def generate_course_structure_with_gemini(file_path: str, game_modes: list = None) -> dict:
    """
    สร้างโครงสร้างคอร์สและเกม (ขับเคลื่อนโดย DeepSeek-Chat V3)
    """
    if game_modes is None or len(game_modes) == 0:
        game_modes = ["standard_quiz"]
        
    try:
        print(f"🚀 [DeepSeek] Generating course structure with modes: {game_modes}")
        
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            file_content = f.read()

        # 🌟 DYNAMIC PROMPT ENGINEERING: อัปเกรดความลึกระดับ Hardcore RPG & Simulation
        mode_instructions = ""
        
        if "standard_quiz" in game_modes:
            mode_instructions += "\n- [STANDARD QUIZ]: สร้างคำถามทดสอบความรู้เชิงลึก เน้นการวิเคราะห์สถานการณ์จริง ไม่ใช่แค่ความจำ"
            
        if "rpg_lore" in game_modes:
            mode_instructions += """
            - [RPG STORYTELLING (DEEP LORE)]: 
              > ห้ามเขียนแบบหนังสือเรียนเด็ดขาด! ให้เขียนเป็น 'นิยายดาร์กแฟนตาซีผสมไซไฟร่วมสมัย (Cyber-Dark Fantasy)'
              > การเล่าเรื่อง (lesson.content) ต้องมี: บรรยากาศแวดล้อมที่กดดัน, เสียง, กลิ่น, และบทสนทนากับ NPC ที่มีมิติ
              > ให้ผู้เรียนเป็น 'คลาสอาชีพ' (เช่น Data-Paladin, Cyber-Necromancer) ที่กำลังทำภารกิจเสี่ยงตาย
              > สอดแทรกความรู้จากเอกสารให้เป็น 'เบาะแส' หรือ 'คัมภีร์เวทมนตร์' ที่ต้องใช้ไขปริศนา
            """
            
        if "turn_based" in game_modes:
            mode_instructions += """
            - [TURN-BASED COMBAT (HARDCORE)]: 
              > เปลี่ยนคำถาม (Question) เป็นสถานการณ์ที่บอสกำลังร่ายเวทย์หรือโจมตี (พร้อมระบุ HP ของบอส เช่น [บอส HP: 1000/1000])
              > ตัวเลือก (Options) คือ 'สกิลโจมตี/ป้องกัน' ที่อิงจากความรู้ในบทเรียน
              > คำอธิบาย (Explanation) ต้องบอกแอ็กชันที่เกิดขึ้นจริง เช่น 'คริติคอล! บอสโดนดาเมจ 250 หน่วย และติดสถานะ [Stun]' หรือถ้าตอบผิด 'คุณโดนสวนกลับ เสีย HP 50 หน่วย (ติดสถานะ [Poison])'
            """
            
        if "base_building" in game_modes:
            mode_instructions += """
            - [BASE BUILDING & ECONOMY]: 
              > ระบบเศรษฐกิจต้องชัดเจน ในคำอธิบายเฉลย (Explanation) ต้องสรุปของรางวัลดรอป (Loot) หากทำสำเร็จ
              > รูปแบบการดรอป: 'คุณได้รับ [วัตถุดิบก่อสร้าง: ไม้กลายพันธุ์ x50], [แร่พลังงาน: Cyber-Crystal x2], และ [Blueprint: หอสังเกตการณ์]'
              > ให้รางวัลสอดคล้องกับความยากของเนื้อหา เพื่อสร้างความอยากรู้อยากเห็นในการอัปเกรดเมือง
            """
        schema_structure = CourseGenerationAI.model_json_schema()

        prompt = f"""
        คุณคือสุดยอด Game Designer และนักเขียนนิยายแฟนตาซี อ้างอิงเอกสารนี้:
        {file_content[:20000]}

        จงประยุกต์ใช้โหมดเกม:
        {mode_instructions}

        ⚠️ กฎเหล็กที่ห้ามละเมิด (CRITICAL RULES):
        1. ตอบกลับเป็น JSON Object เปล่าๆ ตาม Schema นี้เท่านั้น ห้ามมีคำอธิบายอื่น:
        {json.dumps(schema_structure, ensure_ascii=False)}
        2. 🚨 ระวังเครื่องหมายคำพูด! ในเนื้อเรื่องหรือบทสนทนา ห้ามใช้ Double Quotes (") ซ้อนกันเด็ดขาด ให้ใช้ Single Quote (') หรือเครื่องหมายคำพูดภาษาไทย (“ ”) แทน เพื่อป้องกัน JSON พัง

        ตอบกลับมาเป็น JSON เปล่าๆ เท่านั้น
        """

        response = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You output strict valid JSON only. You never use unescaped double quotes inside string values."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        raw_json_str = response.choices[0].message.content.strip()
        
        # 🧹 คลีนอัปข้อมูลเผื่อ AI ส่ง Markdown Codeblock กลับมา
        if raw_json_str.startswith("```json"):
            raw_json_str = raw_json_str[7:-3].strip()
        elif raw_json_str.startswith("```"):
            raw_json_str = raw_json_str[3:-3].strip()
            
        parsed_data = json.loads(raw_json_str)
        validated_course = CourseGenerationAI.model_validate(parsed_data)

        return validated_course.model_dump()

    except json.JSONDecodeError as e:
        print(f"❌ [DeepSeek] JSON Parsing Error: {e}")
        print(f"Raw Output ที่พัง: {raw_json_str[:500]}...") # ปริ้นต์ให้ดูว่าพังตรงไหน
        return {"error": "AI สร้างเนื้อเรื่องที่มีอักขระพิเศษซ้อนกันทำให้โครงสร้างข้อมูลเสียหาย กรุณาลองใหม่อีกครั้ง"}
    except Exception as e:
        print(f"❌ [DeepSeek] Course Generation Error: {e}")
        return {"error": f"AI ไม่สามารถสร้างคอร์สได้: {str(e)}"}