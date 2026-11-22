/**
 * 홈 화면 — 왼쪽에 제목·이어서 하기·코스 카드, 오른쪽에 천천히 도는 3D 몸.
 * 코스 카드에는 지나가는 기관 순서와 실제 진도가 함께 보인다.
 */
import type { Course, CourseId, SaveData, ThemeName } from "../types";
import { COURSES, COURSE_ORDER } from "../data/courses";
import { figureUrl, ICON } from "./assets";

export interface HomeScreenCallbacks {
  onStartCourse(courseId: CourseId): void;
  onRestartCourse(courseId: CourseId): void;
  onExplore(): void;
  onShowResult(): void;
  onResetProgress(): void;
  onToggleTheme(): void;
}

export interface HomeScreenHandle {
  root: HTMLElement;
  update(save: SaveData, theme: ThemeName): void;
}

const MASCOT: Record<CourseId, { key: string; alt: string }> = {
  glucose: { key: "mGlucose", alt: "포도당 캐릭터" },
  oxygen: { key: "mOxygen", alt: "산소 캐릭터" },
};

export function courseStats(course: Course, save: SaveData): {
  visited: number;
  steps: number;
  solved: number;
  quizzes: number;
  pct: number;
  done: boolean;
} {
  const p = save[course.id];
  const ids = new Set(course.steps.map((s) => s.id));
  const visited = p.visitedStepIds.filter((id) => ids.has(id)).length;
  const quizIds = Object.keys(course.quizzes);
  const solved = quizIds.filter((id) => p.quizResults[id]?.solved === true).length;
  const total = course.steps.length + quizIds.length;
  const pct = total === 0 ? 0 : Math.round(((visited + solved) / total) * 100);
  return { visited, steps: course.steps.length, solved, quizzes: quizIds.length, pct, done: pct >= 100 };
}

function courseCardHtml(course: Course): string {
  const m = MASCOT[course.id];
  const route = course.journeySummary
    .map((j) => `<li>${j.label}</li>`)
    .join("");
  return `
  <article class="course-card panel" data-course="${course.id}" data-accent="${course.id}">
    <div class="course-top">
      <div class="mascot mascot-${course.id}"><img src="${figureUrl(m.key)}" alt="${m.alt}" draggable="false" /></div>
      <div class="course-heading">
        <h2 class="course-name">${course.title}</h2>
        <p class="course-sub">${course.subtitle}</p>
      </div>
      <div class="ring" data-role="ring" role="img"><span data-role="pct"></span></div>
    </div>
    <ol class="route-chips" aria-label="${course.title}에서 지나가는 기관">${route}</ol>
    <div class="course-bottom">
      <p class="course-meta" data-role="meta"></p>
      <div class="course-actions">
        <button type="button" class="btn btn-quiet" data-action="restart" hidden>처음부터</button>
        <button type="button" class="btn btn-primary" data-action="start"><span data-role="start-label"></span>${ICON.arrowRight}</button>
      </div>
    </div>
  </article>`;
}

export function createHomeScreen(cb: HomeScreenCallbacks): HomeScreenHandle {
  const root = document.createElement("section");
  root.className = "screen screen-home";
  root.innerHTML = `
    <div class="home-scroll">
      <div class="home-col">
        <header class="home-header">
          <p class="eyebrow">중학교 과학 · 동물과 에너지</p>
          <h1 class="app-title"><em data-accent="glucose">포도당</em>과 <em data-accent="oxygen">산소</em>의 여행</h1>
          <p class="app-lead">떡볶이 한 입과 숨 한 번이 몸속에서 어떻게 <b>에너지</b>가 되는지, 3D 인체 속을 따라가며 배워요.</p>
        </header>

        <div class="course-list">
          ${COURSE_ORDER.map((id) => courseCardHtml(COURSES[id])).join("")}
        </div>

        <div class="home-extra">
          <button type="button" class="tile panel" data-action="explore" data-accent="explore">
            <span class="tile-icon">${ICON.compass}</span>
            <span class="tile-text"><b>자유 탐색</b><small>기관을 눌러 이름과 하는 일을 살펴봐요</small></span>
          </button>
          <button type="button" class="tile panel" data-action="result" data-accent="result">
            <span class="tile-icon">${ICON.trophy}</span>
            <span class="tile-text"><b>학습 결과</b><small data-role="result-meta"></small></span>
          </button>
        </div>

        <footer class="home-footer">
          <span>3D 인체 모델: Z-Anatomy (CC BY-SA 4.0)</span>
          <span class="home-footer-actions">
            <button type="button" class="btn-link" data-action="theme" data-role="theme-btn"></button>
            <button type="button" class="btn-link" data-action="reset">학습 기록 초기화</button>
          </span>
        </footer>
      </div>
      <p class="home-hint" aria-hidden="true">${ICON.pointer} 몸을 끌어서 돌려 보세요</p>
    </div>`;

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "explore") cb.onExplore();
    else if (action === "result") cb.onShowResult();
    else if (action === "reset") cb.onResetProgress();
    else if (action === "theme") cb.onToggleTheme();
    else if (action === "start" || action === "restart") {
      const id = target.closest<HTMLElement>("[data-course]")?.dataset.course;
      if (id !== "glucose" && id !== "oxygen") return;
      if (action === "start") cb.onStartCourse(id);
      else cb.onRestartCourse(id);
    }
  });

  const q = <T extends HTMLElement>(scope: ParentNode, sel: string): T | null => scope.querySelector<T>(sel);

  function update(save: SaveData, theme: ThemeName): void {
    let solvedAll = 0;
    let quizAll = 0;
    for (const id of COURSE_ORDER) {
      const card = q<HTMLElement>(root, `.course-card[data-course="${id}"]`);
      if (card === null) continue;
      const st = courseStats(COURSES[id], save);
      solvedAll += st.solved;
      quizAll += st.quizzes;

      const ring = q<HTMLElement>(card, '[data-role="ring"]');
      if (ring !== null) {
        ring.style.setProperty("--pct", String(st.pct));
        ring.setAttribute("aria-label", `진도 ${st.pct}%`);
        ring.classList.toggle("is-done", st.done);
      }
      const pct = q<HTMLElement>(card, '[data-role="pct"]');
      if (pct !== null) pct.innerHTML = st.done ? ICON.check : `${st.pct}<small>%</small>`;
      const meta = q<HTMLElement>(card, '[data-role="meta"]');
      if (meta !== null) meta.textContent = `${st.steps}단계 · 퀴즈 ${st.solved}/${st.quizzes}`;
      const label = q<HTMLElement>(card, '[data-role="start-label"]');
      const started = st.visited > 0;
      if (label !== null) label.textContent = st.done ? "다시 보기" : started ? "이어서 하기" : "시작하기";
      const restart = q<HTMLButtonElement>(card, '[data-action="restart"]');
      if (restart !== null) restart.hidden = !started || st.done;
    }
    const resultMeta = q<HTMLElement>(root, '[data-role="result-meta"]');
    if (resultMeta !== null) resultMeta.textContent = `퀴즈 ${solvedAll}/${quizAll} 해결`;
    const themeBtn = q<HTMLElement>(root, '[data-role="theme-btn"]');
    if (themeBtn !== null) themeBtn.textContent = theme === "dark" ? "밝은 화면으로" : "어두운 화면으로";
  }

  return { root, update };
}
