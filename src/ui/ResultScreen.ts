/**
 * 결과 화면 — 코스별 진도 고리, 지나온 기관, 문항별 풀이 기록(한 번에 맞혔는지/몇 번 틀렸는지),
 * 두 코스를 모두 마치면 통합 정리 카드.
 */
import type { CourseId, SaveData } from "../types";
import { COURSES, COURSE_ORDER } from "../data/courses";
import { ICON } from "./assets";
import { courseStats } from "./HomeScreen";

export interface ResultScreenCallbacks {
  onHome(): void;
  onRestartCourse(courseId: CourseId): void;
  onGotoStep(courseId: CourseId, stepIndex: number): void;
}

export interface ResultScreenHandle {
  root: HTMLElement;
  update(save: SaveData): void;
}

const strip = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function createResultScreen(cb: ResultScreenCallbacks): ResultScreenHandle {
  const root = document.createElement("section");
  root.className = "screen screen-result";
  root.innerHTML = `
    <div class="result-scroll">
      <div class="result-wrap">
        <header class="result-head">
          <button type="button" class="btn-icon" data-action="home" aria-label="홈으로">${ICON.home}</button>
          <h1 class="result-title">학습 결과</h1>
        </header>
        <section class="unified panel" data-role="unified" hidden>
          <p class="eyebrow">두 여행을 모두 마쳤어요</p>
          <p class="unified-eq"><em data-accent="glucose">포도당</em> + <em data-accent="oxygen">산소</em> → 이산화 탄소 + 물 + <b>에너지</b></p>
          <p class="unified-note">소화계와 호흡계가 받아들인 포도당과 산소를 순환계가 세포로 나르고, 세포호흡으로 에너지를 얻습니다. 이산화 탄소는 폐에서 날숨으로, 물과 요소는 콩팥에서 오줌으로 나가요.</p>
        </section>
        <div class="result-grid" data-role="grid"></div>
      </div>
    </div>`;

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action],[data-goto]") : null;
    if (target === null) return;
    if (target.dataset.action === "home") cb.onHome();
    else if (target.dataset.action === "restart") {
      const id = target.closest<HTMLElement>("[data-course]")?.dataset.course;
      if (id === "glucose" || id === "oxygen") cb.onRestartCourse(id);
    } else if (target.dataset.goto !== undefined) {
      const [courseId, index] = target.dataset.goto.split(":");
      if (courseId === "glucose" || courseId === "oxygen") cb.onGotoStep(courseId, Number.parseInt(index ?? "0", 10));
    }
  });

  function update(save: SaveData): void {
    const grid = root.querySelector<HTMLElement>('[data-role="grid"]');
    if (grid === null) return;
    let allDone = true;
    grid.innerHTML = COURSE_ORDER.map((id) => {
      const course = COURSES[id];
      const st = courseStats(course, save);
      if (!st.done) allDone = false;
      const results = save[id].quizResults;
      const firstTry = Object.keys(course.quizzes).filter((q) => results[q]?.solved === true && results[q]?.wrongCount === 0).length;
      const rows = course.steps
        .map((step, index) => {
          if (step.quizId === undefined) return "";
          const quiz = course.quizzes[step.quizId];
          if (quiz === undefined) return "";
          const r = results[step.quizId];
          const state = r?.solved !== true ? "todo" : r.wrongCount === 0 ? "perfect" : "retry";
          const badge = state === "todo" ? "아직" : state === "perfect" ? "한 번에" : `오답 ${r?.wrongCount ?? 0}`;
          return `<li><button type="button" class="review-row is-${state}" data-goto="${id}:${index}">
            <span class="review-mark">${state === "todo" ? index + 1 : ICON.check}</span>
            <span class="review-text"><small>${step.title}</small>${strip(quiz.question)}</span>
            <span class="review-badge">${badge}</span></button></li>`;
        })
        .join("");
      return `
      <article class="result-card panel" data-course="${id}" data-accent="${id}">
        <div class="result-card-head">
          <div class="ring ring-lg${st.done ? " is-done" : ""}" style="--pct:${st.pct}" role="img" aria-label="진도 ${st.pct}%"><span>${st.pct}<small>%</small></span></div>
          <div>
            <h2 class="course-name">${course.title}</h2>
            <p class="course-meta">단계 ${st.visited}/${st.steps} · 퀴즈 ${st.solved}/${st.quizzes} · 한 번에 맞힌 문제 ${firstTry}</p>
          </div>
        </div>
        <ol class="route-chips">${course.journeySummary.map((j) => `<li>${j.label}</li>`).join("")}</ol>
        <h3 class="block-title">문항별 기록 <small>눌러서 그 단계로 이동</small></h3>
        <ul class="review-list">${rows}</ul>
        <div class="result-actions">
          <button type="button" class="btn btn-quiet" data-action="restart">${ICON.replay}<span>처음부터 다시</span></button>
        </div>
      </article>`;
    }).join("");
    const unified = root.querySelector<HTMLElement>('[data-role="unified"]');
    if (unified !== null) unified.hidden = !allDone;
  }

  return { root, update };
}
