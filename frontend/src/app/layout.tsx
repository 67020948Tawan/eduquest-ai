import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EduQuest AI — Turn Learning into Playable Games",
  description:
    "AI-Powered Educational Game Generation Platform: อัปโหลดบทเรียนแล้วเปลี่ยนเป็นเกมการเรียนรู้ที่เล่นได้จริง",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // ตั้ง data-theme ก่อน paint แรก — กันหน้ากะพริบเปลี่ยนธีมตอนโหลด
  const themeScript = `(function(){try{var t=localStorage.getItem("eduquest_theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
