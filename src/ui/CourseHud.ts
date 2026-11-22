/**
 * 수업 화면 — 영역을 고정한 3단 구성.
 *   상단 바: 홈 · 코스명 · 단원 진행 막대 · 도구
 *   왼쪽 레일: 단원별 단계 목록(여정 지도) — 좁은 화면에서는 서랍
 *   오른쪽 패널: 설명 · 핵심 정리 · 용어 · 확대 자료 · 이동 버튼 (퀴즈가 열리면 같은 자리를 퀴즈가 차지)
 * DOM은 한 번 만들고 update(state)로 값만 바꾼다.
 */
import type { ChapterId, CharacterType, Course, CourseStep } from "../types";
import { CHAPTER_LABELS } from "../data/courses";
import { figureUrl, ICON } from "./assets";

export interface CourseHudCallbacks {
  onHome(): void;
  onPrev(): void;
  onNext(): void;
  onJumpToStep(index: number): void;
  onReplay(): void;
  onOpenQuiz(): void;
  onOpenFigure(src: string, caption: string): void;
}

export interface CourseHudState {
  course: Course;
  stepIndex: number;
  visited: ReadonlySet<string>;
  solved: ReadonlySet<string>;
  /** 단계별 이동 가능 여부 */
  unlocked: readonly boolean[];
  nextEnabled: boolean;
  hasQuiz: boolean;
  quizSolved: boolean;
  quizOpen: boolean;
}

export interface CourseHudHandle {
  root: HTMLElement;
  /** 도구 버튼을 꽂는 자리 */
  toolSlot: HTMLElement;
  /** 퀴즈 패널을 꽂는 자리 (오른쪽 패널 안) */
  quizSlot: HTMLElement;
  /** 3D를 가리는 패널들 — 화면 여백 계산용 */
  rail: HTMLElement;
  side: HTMLElement;
  topbar: HTMLElement;
  update(state: CourseHudState): void;
  setRailOpen(open: boolean): void;
}

const CHARACTER_LABEL: Record<CharacterType, string> = {
  starch: "녹말",
  glucose: "포도당",
  oxygen: "산소",
  co2: "이산화 탄소",
  water: "물과 노폐물",
  nutrient: "영양소",
};

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`CourseHud: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}

/** 연속한 같은 단원끼리 묶는다 */
function groupByChapter(steps: readonly CourseStep[]): { chapter: ChapterId; items: { step: CourseStep; index: number }[] }[] {
  const groups: { chapter: ChapterId; items: { step: CourseStep; index: number }[] }[] = [];
  steps.forEach((step, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.chapter === step.chapter) last.items.push({ step, index });
    else groups.push({ chapter: step.chapter, items: [{ step, index }] });
  });
  return groups;
}

export function createCourseHud(cb: CourseHudCallbacks): CourseHudHandle {
  const root = document.createElement("section");
  root.className = "screen screen-course";
  root.innerHTML = `
    <header class="topbar panel">
      <button type="button" class="btn-icon" data-action="home" aria-label="홈으로">${ICON.home}</button>
      <button type="button" class="btn-icon rail-toggle" data-action="rail" aria-label="단계 목록" aria-expanded="false">${ICON.list}</button>
      <div class="topbar-title">
        <span class="course-dot" aria-hidden="true"></span>
        <span class="topbar-name"></span>
        <span class="topbar-count"></span>
      </div>
      <div class="chapter-bar" aria-hidden="true"></div>
      <div class="topbar-tools"></div>
    </header>

    <div class="rail-scrim" data-action="rail-close" hidden></div>
    <nav class="rail panel" aria-label="단계 목록">
      <div class="rail-head"><span>여정 지도</span><button type="button" class="btn-icon rail-close" data-action="rail-close" aria-label="목록 닫기">${ICON.close}</button></div>
      <div class="rail-list"></div>
    </nav>

    <aside class="side panel">
      <div class="lesson">
        <div class="lesson-scroll" tabindex="0">
          <p class="lesson-chapter"></p>
          <h2 class="lesson-title"></h2>
          <p class="lesson-body"></p>
          <div class="route-note" hidden>
            <span class="route-dot" aria-hidden="true"></span>
            <span class="route-text"></span>
            <button type="button" class="btn-chip" data-action="replay">${ICON.replay}다시 보기</button>
          </div>
          <section class="block">
            <h3 class="block-title">핵심 정리</h3>
            <ul class="key-list"></ul>
          </section>
          <section class="block block-terms" hidden>
            <h3 class="block-title">용어</h3>
            <dl class="term-list"></dl>
          </section>
          <button type="button" class="figure" data-action="figure" hidden>
            <img alt="" loading="lazy" draggable="false" />
            <span class="figure-cap"><span class="figure-cap-text"></span><span class="figure-zoom">${ICON.expand}크게 보기</span></span>
          </button>
          <p class="tip" hidden><span class="tip-icon">${ICON.bulb}</span><span class="tip-text"></span></p>
        </div>
        <footer class="lesson-nav">
          <button type="button" class="btn btn-quiet nav-prev" data-action="prev" aria-label="이전 단계">${ICON.arrowLeft}<span>이전</span></button>
          <button type="button" class="btn btn-quiet nav-quiz" data-action="quiz" hidden>${ICON.quiz}<span>퀴즈</span></button>
          <button type="button" class="btn btn-primary nav-next" data-action="next"><span class="nav-next-label"></span>${ICON.arrowRight}</button>
        </footer>
      </div>
      <div class="quiz-slot"></div>
    </aside>`;

  const topbar = requireEl<HTMLElement>(root, ".topbar");
  const rail = requireEl<HTMLElement>(root, ".rail");
  const railList = requireEl<HTMLElement>(root, ".rail-list");
  const railScrim = requireEl<HTMLElement>(root, ".rail-scrim");
  const railToggle = requireEl<HTMLButtonElement>(root, ".rail-toggle");
  const side = requireEl<HTMLElement>(root, ".side");
  const lesson = requireEl<HTMLElement>(root, ".lesson");
  const lessonScroll = requireEl<HTMLElement>(root, ".lesson-scroll");
  const chapterBar = requireEl<HTMLElement>(root, ".chapter-bar");
  const name = requireEl<HTMLElement>(root, ".topbar-name");
  const count = requireEl<HTMLElement>(root, ".topbar-count");
  const chapterEl = requireEl<HTMLElement>(root, ".lesson-chapter");
  const titleEl = requireEl<HTMLElement>(root, ".lesson-title");
  const bodyEl = requireEl<HTMLElement>(root, ".lesson-body");
  const routeNote = requireEl<HTMLElement>(root, ".route-note");
  const routeText = requireEl<HTMLElement>(root, ".route-text");
  const keyList = requireEl<HTMLElement>(root, ".key-list");
  const termBlock = requireEl<HTMLElement>(root, ".block-terms");
  const termList = requireEl<HTMLElement>(root, ".term-list");
  const figureBtn = requireEl<HTMLButtonElement>(root, ".figure");
  const figureImg = requireEl<HTMLImageElement>(root, ".figure img");
  const figureCap = requireEl<HTMLElement>(root, ".figure-cap-text");
  const tipEl = requireEl<HTMLElement>(root, ".tip");
  const tipText = requireEl<HTMLElement>(root, ".tip-text");
  const prevBtn = requireEl<HTMLButtonElement>(root, ".nav-prev");
  const quizBtn = requireEl<HTMLButtonElement>(root, ".nav-quiz");
  const nextBtn = requireEl<HTMLButtonElement>(root, ".nav-next");
  const nextLabel = requireEl<HTMLElement>(root, ".nav-next-label");

  let shownStepId = "";
  let primaryAction: "next" | "quiz" = "next";

  function setRailOpen(open: boolean): void {
    rail.classList.toggle("is-open", open);
    railScrim.hidden = !open;
    railToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action],[data-step]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "home") cb.onHome();
    else if (action === "rail") setRailOpen(!rail.classList.contains("is-open"));
    else if (action === "rail-close") setRailOpen(false);
    else if (action === "replay") cb.onReplay();
    else if (action === "prev") cb.onPrev();
    else if (action === "quiz") cb.onOpenQuiz();
    else if (action === "next") {
      if (primaryAction === "quiz") cb.onOpenQuiz();
      else cb.onNext();
    } else if (action === "figure") {
      cb.onOpenFigure(figureImg.src, figureCap.textContent ?? "");
    } else if (target.dataset.step !== undefined) {
      setRailOpen(false);
      cb.onJumpToStep(Number.parseInt(target.dataset.step, 10));
    }
  });

  function renderRail(s: CourseHudState): void {
    railList.innerHTML = groupByChapter(s.course.steps)
      .map(
        (g) => `
      <div class="rail-group">
        <p class="rail-chapter">${CHAPTER_LABELS[g.chapter]}</p>
        <ol>
          ${g.items
            .map(({ step, index }) => {
              const unlocked = s.unlocked[index] === true;
              const current = index === s.stepIndex;
              const done = s.visited.has(step.id) && (step.quizId === undefined || s.solved.has(step.quizId));
              const cls = ["rail-item", current ? "is-current" : "", done ? "is-done" : "", unlocked ? "" : "is-locked"].join(" ");
              const mark = !unlocked ? ICON.lock : done ? ICON.check : String(index + 1);
              return `<li><button type="button" class="${cls}" data-step="${index}"${unlocked ? "" : " disabled"}${current ? ' aria-current="step"' : ""}>
                <span class="rail-mark">${mark}</span><span class="rail-label">${step.title}</span></button></li>`;
            })
            .join("")}
        </ol>
      </div>`,
      )
      .join("");
    railList.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }

  function renderChapterBar(s: CourseHudState): void {
    const groups = groupByChapter(s.course.steps);
    chapterBar.innerHTML = groups
      .map((g) => {
        const total = g.items.length;
        const first = g.items[0]?.index ?? 0;
        const passed = Math.max(0, Math.min(total, s.stepIndex - first + 1));
        const active = s.stepIndex >= first && s.stepIndex < first + total;
        return `<div class="chapter-seg${active ? " is-active" : ""}" style="flex:${total}">
          <span class="chapter-name">${CHAPTER_LABELS[g.chapter]}</span>
          <span class="chapter-track"><span style="width:${(passed / total) * 100}%"></span></span>
        </div>`;
      })
      .join("");
  }

  function renderLesson(step: CourseStep): void {
    chapterEl.textContent = CHAPTER_LABELS[step.chapter];
    titleEl.textContent = step.title;
    bodyEl.innerHTML = step.body; // 데이터 파일의 신뢰된 HTML

    if (step.pathId !== undefined && step.character !== undefined) {
      routeNote.hidden = false;
      routeNote.dataset.character = step.character;
      routeText.textContent = `3D에서 ${CHARACTER_LABEL[step.character]}의 이동 경로가 재생돼요`;
    } else if (step.breathing === true) {
      routeNote.hidden = false;
      routeNote.dataset.character = "oxygen";
      routeText.textContent = "3D에서 폐와 가로막이 숨 쉬듯 움직여요";
    } else {
      routeNote.hidden = true;
    }

    keyList.innerHTML = step.keyPoints.map((k) => `<li>${k}</li>`).join("");

    const terms = step.terms ?? [];
    termBlock.hidden = terms.length === 0;
    termList.innerHTML = terms.map((t) => `<div><dt>${t.word}</dt><dd>${t.meaning}</dd></div>`).join("");

    const fig = step.figure;
    const src = fig !== undefined ? figureUrl(fig.key) : "";
    figureBtn.hidden = src === "";
    if (fig !== undefined && src !== "") {
      figureImg.src = src;
      figureImg.alt = fig.caption;
      figureCap.textContent = fig.caption;
    }

    tipEl.hidden = step.tip === undefined;
    tipText.textContent = step.tip ?? "";
    lessonScroll.scrollTop = 0;
  }

  function update(s: CourseHudState): void {
    const course = s.course;
    root.dataset.accent = course.id;
    name.textContent = course.title;
    count.textContent = `${s.stepIndex + 1} / ${course.steps.length}`;

    const step = course.steps[s.stepIndex];
    if (step === undefined) return;
    renderRail(s);
    renderChapterBar(s);
    if (shownStepId !== step.id) {
      shownStepId = step.id;
      renderLesson(step);
    }

    lesson.hidden = s.quizOpen;
    prevBtn.disabled = s.stepIndex === 0;
    const isLast = s.stepIndex === course.steps.length - 1;
    primaryAction = s.hasQuiz && !s.quizSolved ? "quiz" : "next";
    nextLabel.textContent = primaryAction === "quiz" ? "퀴즈 풀기" : isLast ? "결과 보기" : "다음 단계";
    nextBtn.classList.toggle("is-quiz", primaryAction === "quiz");
    quizBtn.hidden = !(s.hasQuiz && s.quizSolved);
  }

  return {
    root,
    toolSlot: requireEl<HTMLElement>(root, ".topbar-tools"),
    quizSlot: requireEl<HTMLElement>(root, ".quiz-slot"),
    rail,
    side,
    topbar,
    update,
    setRailOpen,
  };
}
