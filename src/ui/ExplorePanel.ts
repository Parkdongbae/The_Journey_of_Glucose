/**
 * 자유 탐색 화면 — 왼쪽에 기관계별 기관 목록, 오른쪽에 고른 기관의 설명 카드.
 * 목록에서 고르거나 3D 몸에서 직접 눌러 기관을 살펴보고, 그 기관이 나오는 수업 단계로 바로 갈 수 있다.
 */
import { SYSTEM_LABELS, type CourseId, type OrganSystem, type SystemName } from "../types";
import { ORGANS, ORGAN_MAP } from "../data/organs";
import { COURSES, COURSE_ORDER } from "../data/courses";
import { ICON } from "./assets";

export interface ExplorePanelCallbacks {
  onHome(): void;
  onPickOrgan(organId: string): void;
  onClearOrgan(): void;
  onGotoStep(courseId: CourseId, stepIndex: number): void;
}

export interface ExplorePanelHandle {
  root: HTMLElement;
  toolSlot: HTMLElement;
  rail: HTMLElement;
  side: HTMLElement;
  topbar: HTMLElement;
  showOrgan(organId: string | null): void;
  setRailOpen(open: boolean): void;
}

const SYSTEM_ORDER: readonly SystemName[] = ["digestive", "respiratory", "circulatory", "excretory"];

function systemLabel(system: OrganSystem): string {
  return system === "cell" ? "세포" : SYSTEM_LABELS[system];
}

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`ExplorePanel: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}

/** 이 기관에 초점을 두는 수업 단계들 */
function relatedSteps(organId: string): { courseId: CourseId; index: number; title: string; course: string }[] {
  const out: { courseId: CourseId; index: number; title: string; course: string }[] = [];
  for (const courseId of COURSE_ORDER) {
    const course = COURSES[courseId];
    course.steps.forEach((step, index) => {
      if (step.focusOrganIds.includes(organId)) out.push({ courseId, index, title: step.title, course: course.title });
    });
  }
  return out.slice(0, 4);
}

export function createExplorePanel(cb: ExplorePanelCallbacks): ExplorePanelHandle {
  const root = document.createElement("section");
  root.className = "screen screen-explore";
  root.dataset.accent = "explore";

  const groups = [...SYSTEM_ORDER, "cell" as const]
    .map((system) => {
      const organs = ORGANS.filter((o) => o.system === system);
      if (organs.length === 0) return "";
      return `<div class="rail-group">
        <p class="rail-chapter" data-system="${system}">${systemLabel(system)}</p>
        <ol>${organs
          .map(
            (o) => `<li><button type="button" class="rail-item" data-organ="${o.id}">
              <span class="rail-swatch" style="background:#${o.color.toString(16).padStart(6, "0")}"></span>
              <span class="rail-label">${o.label}</span></button></li>`,
          )
          .join("")}</ol>
      </div>`;
    })
    .join("");

  root.innerHTML = `
    <header class="topbar panel">
      <button type="button" class="btn-icon" data-action="home" aria-label="홈으로">${ICON.home}</button>
      <button type="button" class="btn-icon rail-toggle" data-action="rail" aria-label="기관 목록" aria-expanded="false">${ICON.list}</button>
      <div class="topbar-title">
        <span class="course-dot" aria-hidden="true"></span>
        <span class="topbar-name">자유 탐색</span>
      </div>
      <div class="topbar-spacer"></div>
      <div class="topbar-tools"></div>
    </header>

    <div class="rail-scrim" data-action="rail-close" hidden></div>
    <nav class="rail panel" aria-label="기관 목록">
      <div class="rail-head"><span>기관 목록</span><button type="button" class="btn-icon rail-close" data-action="rail-close" aria-label="목록 닫기">${ICON.close}</button></div>
      <div class="rail-list">${groups}</div>
    </nav>

    <aside class="side side-explore panel">
      <div class="organ-empty">
        <span class="organ-empty-icon">${ICON.pointer}</span>
        <p><b>기관을 골라 보세요</b></p>
        <p>3D 몸에서 기관을 직접 누르거나, 목록에서 이름을 고르면 설명이 나타나요. 빈 곳을 누르면 선택이 풀립니다.</p>
      </div>
      <div class="organ-info" hidden>
        <div class="lesson-scroll">
          <p class="lesson-chapter organ-system"></p>
          <h2 class="lesson-title organ-name"></h2>
          <p class="lesson-body organ-desc"></p>
          <section class="block organ-related" hidden>
            <h3 class="block-title">이 기관이 나오는 수업</h3>
            <ul class="related-list"></ul>
          </section>
        </div>
        <footer class="lesson-nav">
          <button type="button" class="btn btn-quiet" data-action="clear">${ICON.close}<span>선택 해제</span></button>
        </footer>
      </div>
    </aside>`;

  const rail = requireEl<HTMLElement>(root, ".rail");
  const railScrim = requireEl<HTMLElement>(root, ".rail-scrim");
  const railToggle = requireEl<HTMLButtonElement>(root, ".rail-toggle");
  const side = requireEl<HTMLElement>(root, ".side");
  const empty = requireEl<HTMLElement>(root, ".organ-empty");
  const info = requireEl<HTMLElement>(root, ".organ-info");
  const systemEl = requireEl<HTMLElement>(root, ".organ-system");
  const nameEl = requireEl<HTMLElement>(root, ".organ-name");
  const descEl = requireEl<HTMLElement>(root, ".organ-desc");
  const relatedBlock = requireEl<HTMLElement>(root, ".organ-related");
  const relatedList = requireEl<HTMLElement>(root, ".related-list");

  function setRailOpen(open: boolean): void {
    rail.classList.toggle("is-open", open);
    railScrim.hidden = !open;
    railToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action],[data-organ],[data-goto]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "home") cb.onHome();
    else if (action === "rail") setRailOpen(!rail.classList.contains("is-open"));
    else if (action === "rail-close") setRailOpen(false);
    else if (action === "clear") cb.onClearOrgan();
    else if (target.dataset.organ !== undefined) {
      setRailOpen(false);
      cb.onPickOrgan(target.dataset.organ);
    } else if (target.dataset.goto !== undefined) {
      const [courseId, index] = target.dataset.goto.split(":");
      if (courseId === "glucose" || courseId === "oxygen") cb.onGotoStep(courseId, Number.parseInt(index ?? "0", 10));
    }
  });

  function showOrgan(organId: string | null): void {
    for (const el of rail.querySelectorAll<HTMLElement>("[data-organ]")) {
      const on = el.dataset.organ === organId;
      el.classList.toggle("is-current", on);
      if (on) el.scrollIntoView({ block: "nearest" });
    }
    const organ = organId === null ? undefined : ORGAN_MAP.get(organId);
    side.classList.toggle("has-organ", organ !== undefined);
    empty.hidden = organ !== undefined;
    info.hidden = organ === undefined;
    if (organ === undefined) return;
    systemEl.textContent = systemLabel(organ.system);
    nameEl.textContent = organ.label;
    descEl.textContent = organ.description;
    const related = relatedSteps(organ.id);
    relatedBlock.hidden = related.length === 0;
    relatedList.innerHTML = related
      .map(
        (r) => `<li><button type="button" class="related-btn" data-goto="${r.courseId}:${r.index}" data-accent="${r.courseId}">
          <span class="related-course">${r.course}</span><span class="related-title">${r.title}</span>${ICON.arrowRight}</button></li>`,
      )
      .join("");
  }

  return {
    root,
    toolSlot: requireEl<HTMLElement>(root, ".topbar-tools"),
    rail,
    side,
    topbar: requireEl<HTMLElement>(root, ".topbar"),
    showOrgan,
    setRailOpen,
  };
}
