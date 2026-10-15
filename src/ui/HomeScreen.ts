/// <reference types="vite/client" />
/**
 * 홈 화면 — 앱 머리글, 마스코트 썸네일이 달린 코스 카드 2장,
 * 자유 탐색 카드, 귀속 표기 + 학습 기록 초기화 푸터.
 */
import type { Course, CourseId, SaveData } from "../types";
import { COURSES } from "../data/courses";
import glucoseThumb from "../../../images/포도당_기본.jpg";
import oxygenThumb from "../../../images/oxygen/Oxygen Mascot Character.jpg";

export interface HomeScreenCallbacks {
  onStartCourse(courseId: CourseId): void;
  onExplore(): void;
  onShowResult(courseId: CourseId): void;
  onResetProgress(): void;
}

export interface HomeScreenHandle {
  root: HTMLElement;
  update(save: SaveData): void;
}

/** 코스별 카드 강조색 짝(그라데이션 끝점) */
const ACCENT_DEEP: Record<CourseId, string> = {
  glucose: "#f76707",
  oxygen: "#1971c2",
};

const THUMBS: Record<CourseId, { src: string; className: string; alt: string }> = {
  glucose: { src: glucoseThumb, className: "", alt: "포도당 마스코트" },
  oxygen: { src: oxygenThumb, className: "thumb-oxygen", alt: "산소 마스코트" },
};

const COURSE_ORDER: readonly CourseId[] = ["glucose", "oxygen"];

function quizTotals(course: Course, save: SaveData): { solved: number; total: number } {
  const ids = Object.keys(course.quizzes);
  const solved = ids.filter((id) => save[course.id].quizResults[id]?.solved === true).length;
  return { solved, total: ids.length };
}

function isCompleted(course: Course, save: SaveData): boolean {
  const visited = save[course.id].visitedStepIds.length >= course.steps.length;
  const q = quizTotals(course, save);
  return course.steps.length > 0 && visited && q.solved === q.total;
}

function courseCardHtml(course: Course): string {
  const thumb = THUMBS[course.id];
  return `
  <article class="course-card" data-course="${course.id}"
    style="--accent:${course.accentColor}; --accent-deep:${ACCENT_DEEP[course.id]}">
    <div class="course-head">
      <div class="course-thumb">
        <img class="${thumb.className}" src="${thumb.src}" alt="${thumb.alt}" draggable="false" />
      </div>
      <div>
        <h2 class="course-name">${course.title}</h2>
        <p class="course-sub">${course.subtitle}</p>
      </div>
    </div>
    <div class="course-progress">
      <div class="progress-track" role="progressbar"
        aria-label="${course.title} 탐험 진도" data-role="track">
        <div class="progress-fill" data-role="fill"></div>
      </div>
      <p class="progress-meta" data-role="meta"></p>
    </div>
    <div class="course-actions">
      <button class="btn btn-primary" data-action="start"></button>
      <button class="btn btn-ghost" data-action="result" hidden>결과 보기</button>
    </div>
  </article>`;
}

export function createHomeScreen(callbacks: HomeScreenCallbacks): HomeScreenHandle {
  const root = document.createElement("section");
  root.className = "screen screen-home";
  root.innerHTML = `
    <div class="home-scroll">
      <header class="home-header">
        <h1 class="app-title"><em class="t-glucose">포도당</em>과 <em class="t-oxygen">산소</em>의 여행</h1>
        <p class="app-subtitle">3D 인체 탐험</p>
      </header>
      <div class="course-grid">
        ${courseCardHtml(COURSES.glucose)}
        ${courseCardHtml(COURSES.oxygen)}
        <article class="course-card explore-card" style="--accent:var(--c-purple); --accent-deep:#6741d9">
          <div class="course-head">
            <div class="course-thumb explore-thumb" aria-hidden="true">
              <span class="explore-icon"></span>
            </div>
            <div>
              <h2 class="course-name">자유 탐색</h2>
              <p class="course-sub">기관을 클릭해 몸속을 직접 탐험해요</p>
            </div>
          </div>
          <div class="course-actions">
            <button class="btn btn-primary" data-action="explore">탐색하기</button>
          </div>
        </article>
      </div>
      <footer class="home-footer">
        <span class="attribution">3D 골격 모델: Z-Anatomy (CC BY-SA 4.0)</span>
        <button class="btn btn-text" data-action="reset">학습 기록 초기화</button>
      </footer>
    </div>`;

  root.addEventListener("click", (e) => {
    const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-action]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "explore") {
      callbacks.onExplore();
      return;
    }
    if (action === "reset") {
      callbacks.onResetProgress();
      return;
    }
    if (action === "start" || action === "result") {
      const id = target.closest<HTMLElement>("[data-course]")?.dataset.course;
      if (id !== "glucose" && id !== "oxygen") return;
      if (action === "start") callbacks.onStartCourse(id);
      else callbacks.onShowResult(id);
    }
  });

  function update(save: SaveData): void {
    for (const id of COURSE_ORDER) {
      const card = root.querySelector<HTMLElement>(`.course-card[data-course="${id}"]`);
      if (card === null) continue;
      const course = COURSES[id];
      const progress = save[id];
      const visited = progress.visitedStepIds.length;
      const total = course.steps.length;
      const q = quizTotals(course, save);
      const pct = total === 0 ? 0 : Math.round((visited / total) * 100);

      const fill = card.querySelector<HTMLElement>('[data-role="fill"]');
      if (fill !== null) fill.style.width = `${pct}%`;

      const meta = card.querySelector<HTMLElement>('[data-role="meta"]');
      if (meta !== null) meta.textContent = `탐험 ${visited}/${total}단계 · 퀴즈 ${q.solved}/${q.total}`;

      const startBtn = card.querySelector<HTMLButtonElement>('[data-action="start"]');
      if (startBtn !== null) startBtn.textContent = visited === 0 ? "시작하기" : "이어하기";

      const resultBtn = card.querySelector<HTMLButtonElement>('[data-action="result"]');
      if (resultBtn !== null) resultBtn.hidden = !isCompleted(course, save);
    }
  }

  return { root, update };
}
