"use client";

// ==============================================================================
// lib/useAuthToken.ts — Reactive auth state (SSR-safe)
//
// ใช้ useSyncExternalStore อ่าน token จาก localStorage แทนการ setState
// ใน effect (ผ่านกฎ react-hooks/set-state-in-effect ของ React Compiler)
// และ re-render ทันทีเมื่อ login/logout ผ่าน custom event
// ==============================================================================

import { useSyncExternalStore } from "react";

export const AUTH_EVENT = "eduquest:auth";

function subscribe(callback: () => void) {
  window.addEventListener(AUTH_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(AUTH_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): string | null {
  return localStorage.getItem("eduquest_token");
}

function getServerSnapshot(): string | null {
  return null;
}

/** คืน token ปัจจุบัน (null เมื่อยังไม่ login / ฝั่ง server) */
export function useAuthToken(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** แจ้งทุก component ที่ฟังอยู่ว่า auth state เปลี่ยน */
export function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
}
