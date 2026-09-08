import type { Metadata } from "next";
import PublicLanding from "./PublicLanding";

export const metadata: Metadata = {
  title: "เล่นเกมการเรียนรู้ — EduQuest AI",
  description: "เปิดลิงก์แล้วเล่นเกมการเรียนรู้ได้ทันที บนมือถือ แท็บเล็ต หรือคอมพิวเตอร์",
};

export default function PlayPage() {
  return <PublicLanding />;
}
