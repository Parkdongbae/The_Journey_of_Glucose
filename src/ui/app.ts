/**
 * 앱 상태 머신 + 단계 엔진.
 * main.ts가 3D 씬을 먼저 만든 뒤 mountApp(container, scene)을 호출한다.
 * 화면: home / course / explore / result — 캔버스 위에 UI가 떠 있는 구조.
 *
 * 주소(해시)와 화면이 서로 맞물린다: #/ · #/c/<코스>/<단계> · #/explore · #/result
 *   → 뒤로 가기와 링크 공유가 된다.
 * 비동기 연속 동작(카메라 이동 → 경로 재생 → 효과)은 세대 카운터(stepGen)로 무효화해
 * 화면을 빠르게 넘겨도 이전 단계의 연출이 끼어들지 않는다.
 */
import "./styles.css";

import type { AppScreen, Course, CourseId, SaveData, Scene, SystemName, ThemeName, ViewInsets } from "../types";
export type { Scene } from "../types";
import { COURSES } from "../data/courses";
import { getPath } from "../data/paths";
import { ORGAN_MAP } from "../data/organs";
import { loadProgress, resetProgress, saveProgress } from "./progress";
import { loadPrefs, savePrefs } from "./prefs";
import { createCourseHud, type CourseHudHandle } from "./CourseHud";
import { createExplorePanel, type ExplorePanelHandle } from "./ExplorePanel";
import { courseStats, createHomeScreen, type HomeScreenHandle } from "./HomeScreen";
import { createQuizPanel, type QuizPanelHandle } from "./QuizPanel";
import { createResultScreen, type ResultScreenHandle } from "./ResultScreen";
import { createViewTools, type LayerSelection, type ViewToolsHandle } from "./ViewTools";
import { ICON } from "./assets";

const ALL_SYSTEMS: SystemName[] = ["digestive", "respiratory", "circulatory", "excretory"];
const DRAWER_QUERY = "(max-width: 1099px)";
const SHEET_QUERY = "(max-width: 819px)";

type Route =
  | { screen: "home" }
  | { screen: "explore" }
  | { screen: "result" }
  | { screen: "course"; courseId: CourseId; step: number | null };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "explore") return { screen: "explore" };
  if (parts[0] === "result") return { screen: "result" };
  if (parts[0] === "c" && (parts[1] === "glucose" || parts[1] === "oxygen")) {
    const n = Number.parseInt(parts[2] ?? "", 10);
    return { screen: "course", courseId: parts[1], step: Number.isNaN(n) ? null : n - 1 };
  }
  return { screen: "home" };
}

class App {
  private readonly scene: Scene;
  private readonly root: HTMLElement;
  private readonly tooltip: HTMLDivElement;
  private readonly lightbox: HTMLDivElement;
  private readonly home: HomeScreenHandle;
  private readonly hud: CourseHudHandle;
  private readonly quiz: QuizPanelHandle;
  private readonly explore: ExplorePanelHandle;
  private readonly result: ResultScreenHandle;
  private readonly courseTools: ViewToolsHandle;
  private readonly exploreTools: ViewToolsHandle;
  private readonly sections: Record<AppScreen, HTMLElement>;

  private screen: AppScreen = "home";
  private course: Course = COURSES.glucose;
  private stepIndex = 0;
  private stepGen = 0;
  private layer: LayerSelection = "all";
  private labelsOn = false;
  /** 사용자가 직접 고른 뼈대 표시 (null이면 단계 기본값을 따른다) */
  private skeletonOverride: boolean | null = null;
  private exploreOrgan: string | null = null;
  private theme: ThemeName;
  private quality: "low" | "high";

  constructor(root: HTMLElement, scene: Scene) {
    this.root = root;
    this.scene = scene;
    const prefs = loadPrefs();
    this.theme = prefs.theme;
    this.quality = prefs.quality;

    // ---------- 호버 이름 풍선 ----------
    this.tooltip = document.createElement("div");
    this.tooltip.className = "organ-tooltip";
    this.tooltip.hidden = true;
    root.appendChild(this.tooltip);
    this.scene.onHoverChange((organId) => {
      const organ = organId === null ? undefined : ORGAN_MAP.get(organId);
      this.tooltip.hidden = organ === undefined;
      if (organ !== undefined) this.tooltip.textContent = organ.label;
    });
    window.addEventListener("pointermove", (e) => {
      if (this.tooltip.hidden) return;
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY + 12}px`;
    });
    this.scene.onEmptyClick(() => {
      if (this.screen === "explore") this.pickExploreOrgan(null);
    });

    // ---------- 화면 구성 ----------
    this.home = createHomeScreen({
      onStartCourse: (id) => {
        const done = courseStats(COURSES[id], this.save).done;
        this.enterCourse(id, done ? 0 : undefined);
      },
      onRestartCourse: (id) => this.enterCourse(id, 0),
      onExplore: () => this.enterExplore(),
      onShowResult: () => this.openResult(),
      onResetProgress: () => this.resetAll(),
      onToggleTheme: () => this.setTheme(this.theme === "dark" ? "light" : "dark"),
    });

    this.hud = createCourseHud({
      onHome: () => this.goHome(),
      onPrev: () => this.goPrev(),
      onNext: () => this.goNext(),
      onJumpToStep: (index) => this.jumpToStep(index),
      onReplay: () => this.enterStep(this.stepIndex),
      onOpenQuiz: () => this.openQuizPanel(),
      onOpenFigure: (src, caption) => this.openLightbox(src, caption),
    });

    this.quiz = createQuizPanel({
      scene: this.scene,
      onSolved: (quizId, wrongCount) => this.recordQuizSolved(quizId, wrongCount),
      onRequestClose: () => this.closeQuiz(),
      onNext: () => {
        this.quiz.close();
        this.goNext();
      },
    });
    this.hud.quizSlot.appendChild(this.quiz.root);

    this.explore = createExplorePanel({
      onHome: () => this.goHome(),
      onPickOrgan: (id) => this.pickExploreOrgan(id),
      onClearOrgan: () => this.pickExploreOrgan(null),
      onGotoStep: (courseId, index) => this.enterCourse(courseId, index, true),
    });

    this.result = createResultScreen({
      onHome: () => this.goHome(),
      onRestartCourse: (id) => this.enterCourse(id, 0),
      onGotoStep: (courseId, index) => this.enterCourse(courseId, index, true),
    });

    const toolCallbacks = {
      onLayerSelect: (layer: LayerSelection) => this.selectLayer(layer),
      onLabelsToggle: (on: boolean) => {
        this.labelsOn = on;
        this.scene.setLabelsVisible(on);
        this.syncTools();
      },
      onSkeletonToggle: (on: boolean) => {
        this.skeletonOverride = on;
        this.scene.setSkeletonVisible(on, true);
        this.syncTools();
      },
      onOpacityChange: (v: number) => this.scene.setSystemOpacity("all", v),
      onQualityChange: (level: "low" | "high") => {
        this.quality = level;
        savePrefs({ quality: level });
        this.scene.setQuality(level);
        this.syncTools();
      },
      onThemeChange: (theme: ThemeName) => this.setTheme(theme),
    };
    this.courseTools = createViewTools(toolCallbacks);
    this.exploreTools = createViewTools(toolCallbacks);
    this.hud.toolSlot.append(this.courseTools.button);
    this.hud.root.appendChild(this.courseTools.popover);
    this.explore.toolSlot.append(this.exploreTools.button);
    this.explore.root.appendChild(this.exploreTools.popover);

    this.sections = {
      home: this.home.root,
      course: this.hud.root,
      explore: this.explore.root,
      result: this.result.root,
    };
    for (const section of Object.values(this.sections)) {
      section.hidden = true;
      this.root.appendChild(section);
    }

    // ---------- 확대 자료 ----------
    this.lightbox = document.createElement("div");
    this.lightbox.className = "lightbox";
    this.lightbox.hidden = true;
    this.lightbox.setAttribute("role", "dialog");
    this.lightbox.setAttribute("aria-label", "확대 자료");
    this.lightbox.innerHTML = `<figure><img alt="" draggable="false" /><figcaption></figcaption></figure>
      <button type="button" class="btn-icon lightbox-close" aria-label="닫기">${ICON.close}</button>`;
    this.lightbox.addEventListener("click", () => (this.lightbox.hidden = true));
    this.root.appendChild(this.lightbox);

    // ---------- 전역 이벤트 ----------
    window.addEventListener("keydown", (e) => this.onKeydown(e));
    window.addEventListener("hashchange", () => this.applyRoute(parseRoute(window.location.hash)));
    const sync = (): void => this.syncInsets();
    window.addEventListener("resize", sync);
    const ro = new ResizeObserver(sync);
    for (const el of [this.hud.side, this.explore.side, this.hud.rail, this.explore.rail]) ro.observe(el);

    this.setTheme(this.theme, false);
    this.scene.setQuality(this.quality);
    this.applyRoute(parseRoute(window.location.hash), true);
    // 실제 해부 메시가 로드되면 현재 단계의 강조·이름표를 새 메시에 다시 적용
    void this.scene.ready.then(() => {
      if (this.screen === "course") this.applyStepVisuals();
      else if (this.screen === "explore" && this.exploreOrgan !== null) this.scene.highlight([this.exploreOrgan]);
    });
  }

  private get save(): SaveData {
    return loadProgress();
  }

  // ---------- 주소 ----------
  private setRoute(hash: string): void {
    if (window.location.hash !== hash) window.location.hash = hash;
  }

  private applyRoute(route: Route, initial = false): void {
    if (route.screen === "course") {
      const same = this.screen === "course" && this.course.id === route.courseId && route.step === this.stepIndex;
      if (same && !initial) return;
      this.enterCourse(route.courseId, route.step ?? undefined);
    } else if (route.screen === "explore") {
      if (this.screen !== "explore" || initial) this.enterExplore();
    } else if (route.screen === "result") {
      if (this.screen !== "result" || initial) this.openResult();
    } else if (this.screen !== "home" || initial) {
      this.goHome();
    }
  }

  // ---------- 화면 전환 ----------
  private show(screen: AppScreen): void {
    this.screen = screen;
    this.root.dataset.screen = screen;
    for (const key of Object.keys(this.sections) as AppScreen[]) {
      this.sections[key].hidden = key !== screen;
    }
    this.courseTools.close();
    this.exploreTools.close();
    this.hud.setRailOpen(false);
    this.explore.setRailOpen(false);
    this.lightbox.hidden = true;
    this.tooltip.hidden = true;
    this.syncInsets();
  }

  /** 수업·탐색에서 쓰던 3D 상태를 걷어 내고 전신 기본 모습으로 */
  private showcaseBody(): void {
    this.stopSceneActivity();
    this.layer = "all";
    this.scene.setOrganInteractivity(false);
    this.scene.isolateOrgans(null);
    this.scene.setSystemsVisible(ALL_SYSTEMS);
    this.scene.setSystemOpacity("all", 1);
    this.scene.setSkeletonVisible(false);
    this.scene.setFocusLabels([]);
    this.scene.setLabelsVisible(false);
    this.scene.setAutoRotate(true);
    void this.scene.resetView().catch(() => {});
  }

  private goHome(): void {
    this.showcaseBody();
    this.home.update(this.save, this.theme);
    this.show("home");
    this.setRoute("#/");
  }

  private openResult(): void {
    this.showcaseBody();
    this.result.update(this.save);
    this.show("result");
    this.setRoute("#/result");
  }

  private setTheme(theme: ThemeName, persist = true): void {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    this.scene.setTheme(theme);
    if (persist) savePrefs({ theme });
    this.home.update(this.save, theme);
    this.syncTools();
  }

  /** UI 패널이 가린 영역을 3D에 알려, 몸이 남은 빈 영역의 가운데에 오게 한다 */
  private syncInsets(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 };
    if (this.screen === "home") {
      const col = this.home.root.querySelector<HTMLElement>(".home-col");
      if (col !== null && w >= 1000) insets.left = col.getBoundingClientRect().right;
    } else if (this.screen === "course" || this.screen === "explore") {
      const ui = this.screen === "course" ? this.hud : this.explore;
      insets.top = ui.topbar.getBoundingClientRect().bottom;
      const side = ui.side.getBoundingClientRect();
      if (window.matchMedia(SHEET_QUERY).matches) {
        insets.bottom = Math.max(0, h - side.top);
      } else {
        insets.right = Math.max(0, w - side.left);
        if (!window.matchMedia(DRAWER_QUERY).matches) insets.left = ui.rail.getBoundingClientRect().right;
      }
    }
    this.scene.setViewInsets(insets);
  }

  private syncTools(): void {
    const step = this.course.steps[this.stepIndex];
    const skeletonDefault = this.screen === "explore" ? true : step?.showSkeleton === true;
    const state = {
      layer: this.layer,
      labels: this.labelsOn,
      skeleton: this.skeletonOverride ?? skeletonDefault,
      quality: this.quality,
      theme: this.theme,
    };
    this.courseTools.update(state);
    this.exploreTools.update(state);
  }

  // ---------- 진도 ----------
  private isQuizSolved(courseId: CourseId, quizId: string): boolean {
    return this.save[courseId].quizResults[quizId]?.solved === true;
  }

  /** 단계 이동 가능: 첫 단계, 이미 방문, 또는 앞 단계의 퀴즈를 모두 해결 */
  private stepUnlocked(course: Course, index: number): boolean {
    if (index === 0) return true;
    const step = course.steps[index];
    if (step === undefined) return false;
    if (this.save[course.id].visitedStepIds.includes(step.id)) return true;
    for (let i = 0; i < index; i++) {
      const quizId = course.steps[i]?.quizId;
      if (quizId !== undefined && !this.isQuizSolved(course.id, quizId)) return false;
    }
    return true;
  }

  /** 이어서 하기: 방문했지만 퀴즈를 안 푼 단계 → 아직 안 본 단계 → 마지막 단계 */
  private resumeIndex(course: Course): number {
    const progress = this.save[course.id];
    for (let i = 0; i < course.steps.length; i++) {
      const step = course.steps[i];
      if (step === undefined) continue;
      if (!progress.visitedStepIds.includes(step.id)) return i;
      if (step.quizId !== undefined && !this.isQuizSolved(course.id, step.quizId)) return i;
    }
    return Math.max(0, course.steps.length - 1);
  }

  private recordQuizSolved(quizId: string, wrongCount: number): void {
    this.save[this.course.id].quizResults[quizId] = { solved: true, wrongCount };
    saveProgress();
    this.updateHud();
  }

  // ---------- 씬 정리 ----------
  private stopSceneActivity(): void {
    this.stepGen++;
    this.scene.stopPath();
    this.scene.clearHighlight();
    this.scene.clearFx();
    this.scene.setBreathing(false);
    this.quiz.close(); // 펄스 제거 + 기관 클릭 비활성화 포함
  }

  // ---------- 수업 ----------
  private enterCourse(courseId: CourseId, stepIndex?: number, force = false): void {
    this.stopSceneActivity();
    this.course = COURSES[courseId];
    this.exploreOrgan = null;
    this.scene.setAutoRotate(false);
    this.scene.setOrganInteractivity(false);
    this.scene.setSystemOpacity("all", 1);
    this.show("course");
    let index = stepIndex ?? this.resumeIndex(this.course);
    if (index < 0 || index >= this.course.steps.length || (!force && !this.stepUnlocked(this.course, index))) {
      index = this.resumeIndex(this.course);
    }
    this.enterStep(index);
  }

  private enterStep(index: number): void {
    const step = this.course.steps[index];
    if (step === undefined) return;
    this.stopSceneActivity();
    this.stepIndex = index;
    const gen = this.stepGen;
    const course = this.course;

    const progress = this.save[course.id];
    if (!progress.visitedStepIds.includes(step.id)) {
      progress.visitedStepIds.push(step.id);
      saveProgress();
    }
    this.setRoute(`#/c/${course.id}/${index + 1}`);

    // 단계가 바뀌면 수동으로 고른 계통·뼈대 선택은 초기화
    this.layer = "all";
    this.skeletonOverride = null;
    this.scene.isolateOrgans(null);
    this.scene.setSystemsVisible(step.showSystems);
    this.applyStepVisuals();
    this.updateHud();
    this.syncTools();

    const afterShow = (): void => {
      if (gen !== this.stepGen) return;
      for (const fx of step.fx ?? []) this.scene.spawnFx(fx);
    };

    void this.scene
      .flyTo(step.view)
      .then(() => {
        if (gen !== this.stepGen) return;
        if (step.breathing === true) this.scene.setBreathing(true);
        if (step.pathId !== undefined && step.character !== undefined) {
          void this.scene
            .playPath(getPath(step.pathId), step.character, {
              durationSec: step.pathDurationSec ?? 6,
              loops: step.pathLoops ?? 1,
            })
            .then(afterShow, afterShow);
        } else {
          window.setTimeout(afterShow, 600);
        }
      })
      .catch(() => {
        // 카메라 이동이 끊겨도 설명 패널은 그대로 쓸 수 있다
      });
  }

  /** 현재 단계의 강조·이름표·뼈대 */
  private applyStepVisuals(): void {
    const step = this.course.steps[this.stepIndex];
    if (step === undefined) return;
    this.scene.highlight(step.focusOrganIds);
    this.scene.setFocusLabels(step.focusOrganIds);
    this.scene.setLabelsVisible(this.labelsOn);
    this.scene.setSkeletonVisible(this.skeletonOverride ?? step.showSkeleton === true, true);
  }

  private openQuizPanel(): void {
    const step = this.course.steps[this.stepIndex];
    const quizId = step?.quizId;
    if (quizId === undefined) return;
    const quiz = this.course.quizzes[quizId];
    if (quiz === undefined) return;
    const result = this.save[this.course.id].quizResults[quizId];
    // 문제를 푸는 동안에는 이동 경로·효과를 걷어 내 3D를 깨끗이 비운다
    this.stepGen++;
    this.scene.stopPath();
    this.scene.clearFx();
    this.quiz.open(quiz, {
      courseId: this.course.id,
      wrongCount: result?.wrongCount ?? 0,
      alreadySolved: result?.solved === true,
      isLastStep: this.stepIndex === this.course.steps.length - 1,
    });
    this.updateHud();
  }

  private closeQuiz(): void {
    this.quiz.close();
    if (this.screen === "course") {
      const step = this.course.steps[this.stepIndex];
      if (step !== undefined) {
        this.applyStepVisuals();
        void this.scene.flyTo(step.view).catch(() => {});
      }
    }
    this.updateHud();
  }

  private goNext(): void {
    if (this.screen !== "course") return;
    const step = this.course.steps[this.stepIndex];
    if (step === undefined) return;
    if (step.quizId !== undefined && !this.isQuizSolved(this.course.id, step.quizId)) {
      this.openQuizPanel();
      return;
    }
    if (this.stepIndex + 1 < this.course.steps.length) this.enterStep(this.stepIndex + 1);
    else this.openResult();
  }

  private goPrev(): void {
    if (this.screen === "course" && this.stepIndex > 0) this.enterStep(this.stepIndex - 1);
  }

  private jumpToStep(index: number): void {
    if (this.screen === "course" && this.stepUnlocked(this.course, index)) this.enterStep(index);
  }

  private updateHud(): void {
    const course = this.course;
    const step = course.steps[this.stepIndex];
    if (step === undefined) return;
    const progress = this.save[course.id];
    const quizSolved = step.quizId !== undefined && this.isQuizSolved(course.id, step.quizId);
    this.hud.update({
      course,
      stepIndex: this.stepIndex,
      visited: new Set(progress.visitedStepIds),
      solved: new Set(Object.keys(progress.quizResults).filter((id) => progress.quizResults[id]?.solved === true)),
      unlocked: course.steps.map((_, i) => this.stepUnlocked(course, i)),
      nextEnabled: step.quizId === undefined || quizSolved,
      hasQuiz: step.quizId !== undefined,
      quizSolved,
      quizOpen: this.quiz.isOpen(),
    });
    this.syncInsets();
  }

  // ---------- 계통 ----------
  private selectLayer(layer: LayerSelection): void {
    this.layer = layer;
    this.scene.setSystemsVisible(layer === "all" ? ALL_SYSTEMS : [layer]);
    this.syncTools();
  }

  // ---------- 자유 탐색 ----------
  private enterExplore(): void {
    this.stopSceneActivity();
    this.layer = "all";
    this.skeletonOverride = null;
    this.exploreOrgan = null;
    this.scene.setAutoRotate(false);
    this.scene.isolateOrgans(null);
    this.scene.setSystemsVisible(ALL_SYSTEMS);
    this.scene.setFocusLabels([]);
    this.scene.setLabelsVisible(this.labelsOn);
    this.scene.setSkeletonVisible(true, true);
    this.scene.setOrganInteractivity(true);
    this.scene.onOrganClick((organId) => {
      if (this.screen === "explore") this.pickExploreOrgan(organId);
    });
    this.explore.showOrgan(null);
    this.show("explore");
    this.syncTools();
    this.setRoute("#/explore");
    void this.scene.resetView().catch(() => {});
  }

  private pickExploreOrgan(organId: string | null): void {
    const organ = organId === null ? undefined : ORGAN_MAP.get(organId);
    this.exploreOrgan = organ?.id ?? null;
    this.explore.showOrgan(this.exploreOrgan);
    if (organ === undefined) {
      this.scene.clearHighlight();
      this.scene.setFocusLabels([]);
    } else {
      // 고른 기관의 계통이 꺼져 있으면 전체 보기로 되돌린다
      const sys = organ.system === "cell" ? "circulatory" : organ.system;
      if (this.layer !== "all" && this.layer !== sys) this.selectLayer("all");
      this.scene.highlight([organ.id]);
      this.scene.setFocusLabels([organ.id]);
      void this.scene.focusOrgan(organ.id).catch(() => {});
    }
    this.syncInsets();
  }

  // ---------- 기타 ----------
  private openLightbox(src: string, caption: string): void {
    const img = this.lightbox.querySelector("img");
    const cap = this.lightbox.querySelector("figcaption");
    if (img === null || cap === null) return;
    img.src = src;
    img.alt = caption;
    cap.textContent = caption;
    this.lightbox.hidden = false;
  }

  private resetAll(): void {
    const message = "모든 학습 기록을 삭제할까요? 저장된 진도와 퀴즈 결과가 사라집니다.";
    if (window.confirm(message) !== true) return;
    resetProgress();
    this.home.update(this.save, this.theme);
    this.result.update(this.save);
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (!this.lightbox.hidden) this.lightbox.hidden = true;
      else if (this.screen === "course" && this.quiz.isOpen()) this.closeQuiz();
      else {
        this.hud.setRailOpen(false);
        this.explore.setRailOpen(false);
      }
      return;
    }
    if (this.screen !== "course" || this.quiz.isOpen() || !this.lightbox.hidden) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      this.goNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      this.goPrev();
    }
  }
}

/** 컨테이너에 UI 오버레이를 얹는다. 씬은 이미 생성되어 있어야 한다. */
export function mountApp(container: HTMLElement, scene: Scene): void {
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  const root = document.createElement("div");
  root.className = "app-root";
  container.appendChild(root);
  new App(root, scene);
}
