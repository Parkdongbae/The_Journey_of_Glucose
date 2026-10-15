/**
 * 결과 화면 — 두 코스의 진도·퀴즈 점수 요약, 코스별 "다시 배우기",
 * 두 코스를 모두 끝냈을 때 통합 정리 카드.
 */
import type { CourseId, SaveData } from "../types";
import { COURSES } from "../data/courses";

export interface ResultScreenCallbacks {
  onHome(): void;
  onRestartCourse(courseId: CourseId): void;
}

export interface ResultScreenHandle {
  root: HTMLElement;
  update(save: SaveData): void;
}

const ACCENT_DEEP: Record<CourseId, string> = {
  glucose: "#f76707",
  oxygen: "#1971c2",
};

const COURSE_ORDER: readonly CourseId[] = ["glucose", "oxygen"];

function quizTotals(courseId: CourseId, save: SaveData): { solved: number; total: number } {
  const ids = Object.keys(COURSES[courseId].quizzes);
  const solved = ids.filter((id) => save[courseId].quizResults[id]?.solved === true).length;
  return { solved, total: ids.length };
}

function isCompleted(courseId: CourseId, save: SaveData): boolean {
  const course = COURSES[courseId];
  return (
    course.steps.length > 0 &&
    save[courseId].visitedStepIds.length >= course.steps.length &&
    quizTotals(courseId, save).solved === quizTotals(courseId, save).total
  );
}

export function createResultScreen(cb: ResultScreenCallbacks): ResultScreenHandle {
  const root = document.createElement("section");
  root.className = "screen screen-result";
  root.innerHTML = `
    <div class="result-scroll">
      <section class="result-card glass" aria-label="탐험 결과">
        <h1 class="result-title">탐험 결과</h1>
        <div class="result-unified" data-role="unified" hidden>
          <h2>통합 정리 · 두 여행이 만났습니다!</h2>
          <p class="unified-eq">
            <em class="t-glucose">포도당</em> + <em class="t-oxygen">산소</em>
            → <b>에너지</b> + <b>이산화 탄소</b> + <b>물</b>
          </p>
          <p class="unified-note">
            세포에서 일어나는 이 반응을 <b>세포호흡</b>이라고 해요.
            만들어진 <b>이산화 탄소</b>는 <b>폐 → 날숨</b>으로,
            <b>물과 요소</b>는 <b>콩팥 → 오줌</b>으로 몸 밖으로 나갑니다.
          </p>
        </div>
        <div class="result-courses">
          ${COURSE_ORDER.map(
            (id) => `
          <article class="result-row" data-course="${id}"
            style="--accent:${COURSES[id].accentColor}; --accent-deep:${ACCENT_DEEP[id]}">
            <div class="result-row-head">
              <h3>${COURSES[id].title}</h3>
              <span class="result-score" data-role="score"></span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" data-role="fill"></div>
            </div>
            <p class="result-meta" data-role="meta"></p>
            <button class="btn btn-ghost" data-action="restart">다시 배우기</button>
          </article>`
          ).join("")}
        </div>
        <div class="result-actions">
          <button class="btn btn-primary" data-action="home">홈으로</button>
        </div>
      </section>
    </div>`;

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action]") : null;
    if (target === null) return;
    if (target.dataset.action === "home") cb.onHome();
    else if (target.dataset.action === "restart") {
      const id = target.closest<HTMLElement>("[data-course]")?.dataset.course;
      if (id === "glucose" || id === "oxygen") cb.onRestartCourse(id);
    }
  });

  function update(save: SaveData): void {
    for (const id of COURSE_ORDER) {
      const course = COURSES[id];
      const row = root.querySelector<HTMLElement>(`.result-row[data-course="${id}"]`);
      if (row === null) continue;
      const visited = save[id].visitedStepIds.length;
      const total = course.steps.length;
      const q = quizTotals(id, save);
      const pct = total === 0 ? 0 : Math.round((visited / total) * 100);

      const fill = row.querySelector<HTMLElement>('[data-role="fill"]');
      if (fill !== null) fill.style.width = `${pct}%`;
      const score = row.querySelector<HTMLElement>('[data-role="score"]');
      if (score !== null) score.textContent = `퀴즈 ${q.solved}/${q.total}`;
      const meta = row.querySelector<HTMLElement>('[data-role="meta"]');
      if (meta !== null) meta.textContent = `탐험 완료 ${visited}/${total}단계`;
    }
    const unified = root.querySelector<HTMLElement>('[data-role="unified"]');
    if (unified !== null) {
      unified.hidden = !(isCompleted("glucose", save) && isCompleted("oxygen", save));
    }
  }

  return { root, update };
}
