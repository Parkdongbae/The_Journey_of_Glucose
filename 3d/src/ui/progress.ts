/**
 * 진도 저장소 — localStorage 키 "journey_of_glucose_3d_v1".
 * file:// 로 열면 localStorage가 차단될 수 있으므로 try/catch로 메모리 폴백.
 * UI는 모듈이 캐싱한 단일 SaveData 객체를 직접 읽고 갱신한 뒤 saveProgress()로 저장.
 */
import type { CourseId, CourseProgress, ProgressStore, QuizResult, SaveData } from "../types";

const STORAGE_KEY = "journey_of_glucose_3d_v1";
const COURSE_IDS: readonly CourseId[] = ["glucose", "oxygen"];

function emptyCourseProgress(): CourseProgress {
  return { visitedStepIds: [], quizResults: {} };
}

function emptySaveData(): SaveData {
  return { glucose: emptyCourseProgress(), oxygen: emptyCourseProgress() };
}

function sanitizeQuizResults(raw: unknown): Record<string, QuizResult> {
  const out: Record<string, QuizResult> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as Partial<QuizResult>;
    if (typeof v.solved !== "boolean" || typeof v.wrongCount !== "number") continue;
    out[key] = { solved: v.solved, wrongCount: v.wrongCount };
  }
  return out;
}

function sanitizeCourseProgress(raw: unknown): CourseProgress {
  if (typeof raw !== "object" || raw === null) return emptyCourseProgress();
  const v = raw as Partial<CourseProgress>;
  const visited = Array.isArray(v.visitedStepIds)
    ? v.visitedStepIds.filter((x): x is string => typeof x === "string")
    : [];
  return { visitedStepIds: visited, quizResults: sanitizeQuizResults(v.quizResults) };
}

function sanitizeSaveData(raw: unknown): SaveData {
  const out = emptySaveData();
  if (typeof raw !== "object" || raw === null) return out;
  const v = raw as Partial<Record<CourseId, unknown>>;
  for (const id of COURSE_IDS) {
    out[id] = sanitizeCourseProgress(v[id]);
  }
  return out;
}

/** 모듈 수준 캐시 — 반환/저장 모두 이 객체 기준. */
let cache: SaveData | null = null;

function readFromStorage(): SaveData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptySaveData();
    return sanitizeSaveData(JSON.parse(raw) as unknown);
  } catch {
    // 저장소 차단(file://) 또는 손상된 JSON — 메모리 기본값 사용
    return emptySaveData();
  }
}

/** 현재 진도를 반환한다. 최초 1회만 저장소를 읽고 이후는 캐시를 돌려준다. */
export function loadProgress(): SaveData {
  if (cache === null) cache = readFromStorage();
  return cache;
}

/** 캐시의 현재 상태를 저장소에 기록한다. 저장 불가 환경에서는 조용히 무시. */
export function saveProgress(): void {
  if (cache === null) cache = emptySaveData();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // file:// 등 쓰기 차단 — 메모리 상태만 유지
  }
}

/** 모든 진도를 삭제하고 기본 상태로 되돌린다. */
export function resetProgress(): void {
  cache = emptySaveData();
  saveProgress();
}

/** types.ts의 ProgressStore 계약을 만족하는 래퍼. */
export const progressStore: ProgressStore = {
  load: loadProgress,
  save(data: SaveData): void {
    cache = sanitizeSaveData(data);
    saveProgress();
  },
  reset: resetProgress,
};
