/**
 * 앱 상태 머신 + 스텝 엔진 (UI의 심장).
 * main.ts가 3D 씬을 먼저 만든 뒤 mountApp(container, scene)을 호출한다고 가정.
 * 화면: home / course / explore / result — 캔버스 위에 UI가 떠 있는 구조.
 *
 * 스텝 진입 순서(enterStep): 씬 정리 → 계통 표시 → 카메라 이동 → 하이라이트 →
 * 호흡 데모 → 경로 애니메이션(백그라운드) → FX/퀴즈 자동 오픈.
 * 비동기 연속 동작은 세대 카운터(stepGen)로 무효화하여 빠른 화면 전환에도 안전.
 */
import "./styles.css";

import type {
  AppScreen,
  Course,
  CourseId,
  CourseStep,
  Quiz,
  SaveData,
  Scene,
  SystemName,
} from "../types";
export type { Scene } from "../types";
import { COURSES } from "../data/courses";
import { getPath } from "../data/paths";
import { ORGAN_MAP } from "../data/organs";
import { loadProgress, resetProgress, saveProgress } from "./progress";
import { createCourseHud, type CourseHudHandle, type CourseHudState, type LayerSelection } from "./CourseHud";
import { createExplorePanel, type ExploreLayer, type ExplorePanelHandle } from "./ExplorePanel";
import { createHomeScreen, type HomeScreenHandle } from "./HomeScreen";
import { createQuizPanel, type QuizPanelHandle } from "./QuizPanel";
import { createResultScreen, type ResultScreenHandle } from "./ResultScreen";

const ALL_SYSTEMS: SystemName[] = ["digestive", "respiratory", "circulatory", "excretory"];

class App {
  private readonly scene: Scene;
  private readonly root: HTMLElement;
  private readonly tooltip: HTMLDivElement;
  private readonly home: HomeScreenHandle;
  private readonly hud: CourseHudHandle;
  private readonly quiz: QuizPanelHandle;
  private readonly explore: ExplorePanelHandle;
  private readonly result: ResultScreenHandle;
  private readonly sections: Record<AppScreen, HTMLElement>;

  private screen: AppScreen = "home";
  private course: Course = COURSES.glucose;
  private stepIndex = 0;
  private stepGen = 0;
  private activeLayer: LayerSelection = "all";
  private exploreLayer: ExploreLayer = "all";
  private labelsOn = false;

  constructor(root: HTMLElement, scene: Scene) {
    this.root = root;
    this.scene = scene;

    this.tooltip = document.createElement("div");
    this.tooltip.className = "organ-tooltip";
    this.tooltip.hidden = true;
    root.appendChild(this.tooltip);
    this.scene.onHoverChange((organId) => {
      if (organId === null) {
        this.tooltip.hidden = true;
        return;
      }
      const organ = ORGAN_MAP.get(organId);
      if (organ === undefined) {
        this.tooltip.hidden = true;
        return;
      }
      this.tooltip.textContent = organ.label;
      this.tooltip.hidden = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (this.tooltip.hidden) return;
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY + 10}px`;
    });
    this.scene.onEmptyClick(() => {
      if (this.screen === "explore") {
        this.scene.isolateOrgans(null);
        this.scene.clearHighlight();
        this.explore.showOrgan(null);
      }
    });

    this.home = createHomeScreen({
      onStartCourse: (courseId) => this.enterCourse(courseId),
      onExplore: () => this.enterExplore(),
      onShowResult: () => this.openResult(),
      onResetProgress: () => this.resetAll(),
    });

    this.hud = createCourseHud({
      onHome: () => this.goHome(),
      onPrev: () => this.goPrev(),
      onNext: () => this.goNext(),
      onJumpToStep: (index) => this.jumpToStep(index),
      onReplay: () => this.enterStep(this.stepIndex),
      onOpenQuiz: () => this.openQuizPanel(),
      onLayerSelect: (layer) => this.selectCourseLayer(layer),
      onToggleLayerPanel: () => this.hud.setLayerPanelOpen(!this.hud.isLayerPanelOpen()),
      onOpacityChange: (v) => this.scene.setSystemOpacity(this.activeLayer === "all" ? "all" : this.activeLayer, v),
      onLabelsToggle: (on) => this.setLabels(on),
    });

    this.quiz = createQuizPanel({
      scene: this.scene,
      onSolved: (quizId, wrongCount) => this.recordQuizSolved(quizId, wrongCount),
      onRequestClose: () => this.closeQuiz(),
    });

    this.explore = createExplorePanel({
      onHome: () => this.goHome(),
      onLayerSelect: (layer) => this.selectExploreLayer(layer),
      onSkeletonToggle: (on) => this.setSkeleton(on),
      onToggleLayerPanel: () => this.explore.setLayerPanelOpen(!this.explore.isLayerPanelOpen()),
      onOpacityChange: (v) => this.scene.setSystemOpacity(this.exploreLayer === "all" ? "all" : this.exploreLayer, v),
      onLabelsToggle: (on) => this.setLabels(on),
    });

    this.result = createResultScreen({
      onHome: () => this.goHome(),
      onRestartCourse: (courseId) => this.enterCourse(courseId, 0),
    });

    this.hud.root.appendChild(this.quiz.root); // 퀴즈 오버레이는 코스 화면 위에 뜸
    this.sections = {
      home: this.home.root,
      course: this.hud.root,
      explore: this.explore.root,
      result: this.result.root,
    };
    for (const section of Object.values(this.sections)) this.root.appendChild(section);

    window.addEventListener("keydown", (e) => this.onKeydown(e));

    this.home.update(this.save);
    this.show("home");
  }

  private get save(): SaveData {
    return loadProgress();
  }

  // ---------- 화면 전환 ----------
  private show(screen: AppScreen): void {
    this.screen = screen;
    for (const key of Object.keys(this.sections) as AppScreen[]) {
      this.sections[key].hidden = key !== screen;
    }
  }

  private goHome(): void {
    this.stopSceneActivity();
    this.home.update(this.save);
    this.show("home");
  }

  private openResult(): void {
    this.stopSceneActivity();
    this.result.update(this.save);
    this.show("result");
  }

  // ---------- 진도 유틸 ----------
  private courseProgress(courseId: CourseId) {
    return this.save[courseId];
  }

  private isQuizSolved(courseId: CourseId, quizId: string): boolean {
    return this.courseProgress(courseId).quizResults[quizId]?.solved === true;
  }

  /** 단계 i 점프 가능: 첫 단계, 이미 방문, 또는 앞의 모든 퀴즈 해결 */
  private stepUnlocked(course: Course, index: number): boolean {
    if (index === 0) return true;
    const step = course.steps[index];
    if (step === undefined) return false;
    if (this.courseProgress(course.id).visitedStepIds.includes(step.id)) return true;
    for (let i = 0; i < index; i++) {
      const quizId = course.steps[i]?.quizId;
      if (quizId !== undefined && !this.isQuizSolved(course.id, quizId)) return false;
    }
    return true;
  }

  /** 이어하기: 퀴즈 미해결 단계 → 미방문 단계 → 마지막 단계 순으로 복귀 지점 결정 */
  private resumeIndex(course: Course): number {
    const progress = this.courseProgress(course.id);
    for (let i = 0; i < course.steps.length; i++) {
      const quizId = course.steps[i]?.quizId;
      if (quizId !== undefined && !this.isQuizSolved(course.id, quizId)) return i;
    }
    for (let i = 0; i < course.steps.length; i++) {
      const step = course.steps[i];
      if (step !== undefined && !progress.visitedStepIds.includes(step.id)) return i;
    }
    return Math.max(0, course.steps.length - 1);
  }

  private recordQuizSolved(quizId: string, wrongCount: number): void {
    this.courseProgress(this.course.id).quizResults[quizId] = { solved: true, wrongCount };
    saveProgress();
    this.updateCourseHud();
  }

  // ---------- 씬 정리 ----------
  /** 진행 중인 경로/강조/FX/호흡/퀴즈를 모두 멈추고 세대를 올려 비동기 연속을 무효화 */
  private stopSceneActivity(): void {
    this.stepGen++;
    this.scene.stopPath();
    this.scene.clearHighlight();
    this.scene.clearFx();
    this.scene.setBreathing(false);
    this.quiz.close(); // 펄스 제거 + 기관 클릭 비활성화 포함
  }

  // ---------- 코스 진입/스텝 엔진 ----------
  private enterCourse(courseId: CourseId, stepIndex?: number): void {
    this.stopSceneActivity();
    this.course = COURSES[courseId];
    this.activeLayer = "all";
    this.setSkeleton(false);
    this.explore.showOrgan(null);
    this.show("course");
    this.enterStep(stepIndex ?? this.resumeIndex(this.course));
  }

  private enterStep(index: number): void {
    const step = this.course.steps[index];
    if (step === undefined) return;
    this.stopSceneActivity();
    this.stepIndex = index;
    const gen = this.stepGen;
    const course = this.course;

    const progress = this.courseProgress(course.id);
    if (!progress.visitedStepIds.includes(step.id)) {
      progress.visitedStepIds.push(step.id);
      saveProgress();
    }

    // 스텝 기본 연출 (레이어 수동 선택은 단계가 바뀌면 초기화)
    this.activeLayer = "all";
    this.scene.setSystemsVisible(step.showSystems);
    this.setSkeleton(false);
    this.updateCourseHud();

    void this.scene
      .flyTo(step.view)
      .then(() => {
        if (gen !== this.stepGen) return;
        this.scene.highlight(step.focusOrganIds);
        if (step.breathing === true) this.scene.setBreathing(true);

        const afterShow = (): void => {
          if (gen !== this.stepGen) return;
          if (step.fx !== undefined) {
            for (const fx of step.fx) this.scene.spawnFx(fx);
          }
          this.maybeAutoOpenQuiz(step, gen);
        };

        if (step.pathId !== undefined && step.character !== undefined) {
          void this.scene
            .playPath(getPath(step.pathId), step.character, {
              durationSec: step.pathDurationSec ?? 6,
              loops: step.pathLoops ?? 1,
            })
            .then(afterShow, afterShow);
        } else {
          window.setTimeout(afterShow, 1000);
        }
      })
      .catch(() => {
        // 카메라 이동 실패 시에도 스텝 패널은 사용 가능
      });
  }

  private maybeAutoOpenQuiz(step: CourseStep, gen: number): void {
    if (step.quizId === undefined) return;
    if (this.isQuizSolved(this.course.id, step.quizId)) return;
    if (this.quiz.isOpen()) return;
    if (gen !== this.stepGen) return;
    this.openQuizPanel();
  }

  private openQuizPanel(): void {
    const step = this.course.steps[this.stepIndex];
    const quizId = step?.quizId;
    if (quizId === undefined) return;
    const quiz: Quiz | undefined = this.course.quizzes[quizId];
    if (quiz === undefined) return;
    const wrongCount = this.courseProgress(this.course.id).quizResults[quizId]?.wrongCount ?? 0;
    this.quiz.open(quiz, wrongCount);
    this.updateCourseHud();
  }

  private closeQuiz(): void {
    this.quiz.close();
    if (this.screen === "course") {
      const step = this.course.steps[this.stepIndex];
      if (step !== undefined) {
        this.scene.highlight(step.focusOrganIds);
        void this.scene.flyTo(step.view).catch(() => {});
      }
    }
    this.updateCourseHud();
  }

  // ---------- 코스 내비게이션 ----------
  private goNext(): void {
    if (this.screen !== "course") return;
    const step = this.course.steps[this.stepIndex];
    if (step === undefined) return;
    if (step.quizId !== undefined && !this.isQuizSolved(this.course.id, step.quizId)) return;
    if (this.stepIndex + 1 < this.course.steps.length) this.enterStep(this.stepIndex + 1);
    else this.openResult();
  }

  private goPrev(): void {
    if (this.screen !== "course") return;
    if (this.stepIndex > 0) this.enterStep(this.stepIndex - 1);
  }

  private jumpToStep(index: number): void {
    if (this.screen !== "course") return;
    if (this.stepUnlocked(this.course, index)) this.enterStep(index);
  }

  private updateCourseHud(): void {
    const course = this.course;
    const step = course.steps[this.stepIndex];
    if (step === undefined) return;
    const quizSolved = step.quizId !== undefined && this.isQuizSolved(course.id, step.quizId);
    const state: CourseHudState = {
      course,
      stepIndex: this.stepIndex,
      visited: new Set<string>(this.courseProgress(course.id).visitedStepIds),
      unlocked: course.steps.map((_, i) => this.stepUnlocked(course, i)),
      nextEnabled: step.quizId === undefined || quizSolved,
      hasQuiz: step.quizId !== undefined,
      quizSolved,
      activeLayer: this.activeLayer,
    };
    this.hud.update(state);
  }

  // ---------- 레이어 / 골격 ----------
  private selectCourseLayer(layer: LayerSelection): void {
    this.activeLayer = layer;
    this.scene.setSystemsVisible(layer === "all" ? ALL_SYSTEMS : [layer]);
    this.updateCourseHud();
  }

  private selectExploreLayer(layer: ExploreLayer): void {
    this.exploreLayer = layer;
    this.scene.setSystemsVisible(layer === "all" ? ALL_SYSTEMS : [layer]);
    this.explore.setActiveLayer(layer);
  }

  private setLabels(on: boolean): void {
    this.labelsOn = on;
    this.scene.setLabelsVisible(on);
    this.explore.setLabels(on);
  }

  private setSkeleton(on: boolean): void {
    this.scene.setSkeletonVisible(on);
    this.explore.setSkeleton(on);
  }

  // ---------- 자유 탐색 ----------
  private enterExplore(): void {
    this.stopSceneActivity();
    this.activeLayer = "all";
    this.scene.setSystemsVisible(ALL_SYSTEMS);
    this.scene.setOrganInteractivity(true);
    this.scene.onOrganClick((organId) => {
      if (this.screen !== "explore") return;
      const organ = ORGAN_MAP.get(organId);
      if (organ === undefined) return;
      this.scene.isolateOrgans([organId]);
      this.scene.highlight([organId]);
      this.explore.showOrgan({ label: organ.label, description: organ.description });
    });
    this.setSkeleton(true);
    this.explore.setActiveLayer("all");
    this.explore.setLabels(this.labelsOn);
    this.explore.showOrgan(null);
    this.show("explore");
    void this.scene.resetView().catch(() => {});
  }

  // ---------- 기타 ----------
  private resetAll(): void {
    const message = "모든 학습 기록을 삭제할까요? 저장된 진도와 퀴즈 결과가 사라집니다.";
    if (window.confirm(message) !== true) return;
    resetProgress();
    this.home.update(this.save);
    this.result.update(this.save);
  }

  private onKeydown(e: KeyboardEvent): void {
    if (this.screen !== "course") return;
    if (this.quiz.isOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeQuiz();
      }
      return;
    }
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
