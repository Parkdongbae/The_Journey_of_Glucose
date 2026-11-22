/**
 * 화면 설정(테마·품질) 저장 — 학습 진도(journey_of_glucose_3d_v1)와 별도 키를 써서
 * 기존 사용자의 진도 데이터 형식을 건드리지 않는다.
 */
import type { ThemeName } from "../types";

const KEY = "journey_of_glucose_3d_prefs";

export interface Prefs {
  theme: ThemeName;
  quality: "low" | "high";
}

function defaults(): Prefs {
  // 저사양 기기(코어·메모리가 적은 학교 노트북·태블릿)는 낮은 품질로 시작
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
  return { theme: "dark", quality: weak ? "low" : "high" };
}

let cache: Prefs | null = null;

export function loadPrefs(): Prefs {
  if (cache !== null) return cache;
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<Prefs>;
      if (v.theme === "dark" || v.theme === "light") base.theme = v.theme;
      if (v.quality === "low" || v.quality === "high") base.quality = v.quality;
    }
  } catch {
    // 저장소 차단(file://) — 기본값 사용
  }
  cache = base;
  return base;
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 메모리 상태만 유지
  }
  return next;
}
