/**
 * 코스 HUD — 상단 바(홈/코스명/다시 보기), 우측 계통 레이어 패널,
 * 하단 스텝 패널(진행 점 · 본문 · 이전/퀴즈/다음).
 * DOM은 1회 구성하고 update(state)로 값만 갱신한다.
 */
import type { Course, CourseStep, SystemName } from "../types";

export type LayerSelection = "all" | SystemName;

export interface CourseHudCallbacks {
  onHome(): void;
  onPrev(): void;
  onNext(): void;
  onJumpToStep(index: number): void;
  onReplay(): void;
  onOpenQuiz(): void;
  onLayerSelect(layer: LayerSelection): void;
  onToggleLayerPanel(): void;
  onOpacityChange(opacity: number): void;
  onLabelsToggle(on: boolean): void;
}

export interface CourseHudState {
  course: Course;
  stepIndex: number;
  visited: ReadonlySet<string>;
  /** 단계별 점프 가능 여부 (이전 단계 퀴즈를 모두 풀었거나 이미 방문) */
  unlocked: readonly boolean[];
  nextEnabled: boolean;
  hasQuiz: boolean;
  quizSolved: boolean;
  activeLayer: LayerSelection;
}

export interface CourseHudHandle {
  root: HTMLElement;
  update(state: CourseHudState): void;
  setLayerPanelOpen(open: boolean): void;
  isLayerPanelOpen(): boolean;
}

const ICON_HOME = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`;
const ICON_MENU = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;
const ICON_REPLAY = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`;

/** 코스 강조색 그라데이션 끝점 */
const ACCENT_DEEP: Record<string, string> = {
  "#ff9f43": "#f76707",
  "#4dabf7": "#1971c2",
};

const LAYERS: readonly { layer: LayerSelection; label: string }[] = [
  { layer: "all", label: "몸 전체" },
  { layer: "digestive", label: "소화계" },
  { layer: "respiratory", label: "호흡계" },
  { layer: "circulatory", label: "순환계" },
  { layer: "excretory", label: "배설계" },
];

export function createCourseHud(cb: CourseHudCallbacks): CourseHudHandle {
  const root = document.createElement("section");
  root.className = "screen screen-course";
  root.innerHTML = `
    <header class="hud-top glass">
      <button class="btn-icon" data-action="home" aria-label="홈으로 이동">${ICON_HOME}</button>
      <div class="hud-title">
        <span class="hud-course-dot" aria-hidden="true"></span>
        <span class="hud-course-name"></span>
        <span class="hud-step-count"></span>
      </div>
      <button class="btn btn-ghost hud-replay" data-action="replay">
        ${ICON_REPLAY}<span class="replay-label">이 단계 다시 보기</span>
      </button>
      <button class="btn-icon layer-toggle" data-action="toggle-layer" aria-label="계통 패널 열기 닫기">${ICON_MENU}</button>
    </header>

    <aside class="layer-panel glass" aria-label="표시할 계통 선택">
      <h3 class="panel-title">몸속 계통</h3>
      <div class="chip-group">
        ${LAYERS.map((l) => `<button class="chip" data-layer="${l.layer}" aria-pressed="false">${l.label}</button>`).join("")}
      </div>
      <label class="opacity-row">
        <span>투명도</span>
        <input class="opacity-slider" type="range" min="10" max="100" value="100" aria-label="계통 투명도" />
      </label>
      <button class="chip chip-wide" data-labels aria-pressed="false">기관 라벨</button>
    </aside>

    <div class="step-panel glass">
      <div class="step-dots" role="group" aria-label="단계 목록"></div>
      <h2 class="step-title"></h2>
      <div class="step-body" tabindex="0" aria-live="polite"></div>
      <div class="step-actions">
        <button class="btn btn-ghost step-prev" data-action="prev">← 이전</button>
        <button class="btn btn-ghost step-quiz" data-action="quiz" hidden>퀴즈 풀기</button>
        <button class="btn btn-primary step-next" data-action="next">다음 →</button>
      </div>
    </div>`;

  const courseName = requireEl<HTMLSpanElement>(root, ".hud-course-name");
  const stepCount = requireEl<HTMLSpanElement>(root, ".hud-step-count");
  const dots = requireEl<HTMLDivElement>(root, ".step-dots");
  const stepTitle = requireEl<HTMLHeadingElement>(root, ".step-title");
  const stepBody = requireEl<HTMLDivElement>(root, ".step-body");
  const prevBtn = requireEl<HTMLButtonElement>(root, ".step-prev");
  const quizBtn = requireEl<HTMLButtonElement>(root, ".step-quiz");
  const nextBtn = requireEl<HTMLButtonElement>(root, ".step-next");
  const layerPanel = requireEl<HTMLElement>(root, ".layer-panel");
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>(".layer-panel .chip[data-layer]"));
  const labelsChip = requireEl<HTMLButtonElement>(root, "[data-labels]");
  const opacitySlider = requireEl<HTMLInputElement>(root, ".opacity-slider");

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action],[data-layer],[data-step],[data-labels]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "home") cb.onHome();
    else if (action === "replay") cb.onReplay();
    else if (action === "toggle-layer") cb.onToggleLayerPanel();
    else if (action === "prev") cb.onPrev();
    else if (action === "next") cb.onNext();
    else if (action === "quiz") cb.onOpenQuiz();
    else if (target.dataset.labels !== undefined) {
      const on = labelsChip.getAttribute("aria-pressed") !== "true";
      labelsChip.setAttribute("aria-pressed", on ? "true" : "false");
      labelsChip.classList.toggle("active", on);
      cb.onLabelsToggle(on);
    } else if (target.dataset.layer !== undefined) {
      const layer = LAYERS.find((l) => l.layer === target.dataset.layer)?.layer;
      if (layer !== undefined) cb.onLayerSelect(layer);
    } else if (target.dataset.step !== undefined) {
      cb.onJumpToStep(Number.parseInt(target.dataset.step, 10));
    }
  });

  opacitySlider.addEventListener("input", () => {
    cb.onOpacityChange(Number.parseInt(opacitySlider.value, 10) / 100);
  });

  function update(s: CourseHudState): void {
    const course = s.course;
    root.style.setProperty("--accent", course.accentColor);
    root.style.setProperty("--accent-deep", ACCENT_DEEP[course.accentColor] ?? course.accentColor);

    courseName.textContent = course.title;
    stepCount.textContent = `${s.stepIndex + 1} / ${course.steps.length}`;

    dots.innerHTML = course.steps
      .map((step, i) => {
        const classes = ["dot"];
        if (s.visited.has(step.id)) classes.push("visited");
        if (i === s.stepIndex) classes.push("current");
        if (step.quizId !== undefined) classes.push("has-quiz");
        const unlocked = s.unlocked[i] === true;
        const label = `${i + 1}단계 ${step.title}${unlocked ? "" : " (잠김)"}`;
        return `<button class="${classes.join(" ")}" data-step="${i}" aria-label="${label}"` +
          `${unlocked ? "" : " disabled"}${i === s.stepIndex ? ' aria-current="step"' : ""}></button>`;
      })
      .join("");

    const step = course.steps[s.stepIndex] as CourseStep | undefined;
    if (step === undefined) return;
    stepTitle.textContent = step.title;
    stepBody.innerHTML = step.body;

    prevBtn.disabled = s.stepIndex === 0;
    const isLast = s.stepIndex === course.steps.length - 1;
    nextBtn.textContent = isLast ? "결과 보기" : "다음 →";
    nextBtn.disabled = !s.nextEnabled;

    quizBtn.hidden = !s.hasQuiz;
    quizBtn.textContent = s.quizSolved ? "퀴즈 다시 보기" : "퀴즈 풀기";

    for (const chip of chips) {
      const active = chip.dataset.layer === s.activeLayer;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function setLayerPanelOpen(open: boolean): void {
    layerPanel.classList.toggle("layer-open", open);
  }

  function isLayerPanelOpen(): boolean {
    return layerPanel.classList.contains("layer-open");
  }

  return { root, update, setLayerPanelOpen, isLayerPanelOpen };
}

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`CourseHud: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}
