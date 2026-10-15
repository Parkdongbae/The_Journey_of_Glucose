/**
 * 자유 탐색 화면 — 상단 바(홈/제목), 우측 계통·뼈대 칩 패널,
 * 기관 클릭 시 뜨는 정보 카드.
 */
import type { SystemName } from "../types";

export type ExploreLayer = "all" | SystemName;

export interface ExplorePanelCallbacks {
  onHome(): void;
  onLayerSelect(layer: ExploreLayer): void;
  onSkeletonToggle(on: boolean): void;
  onToggleLayerPanel(): void;
  onOpacityChange(opacity: number): void;
  onLabelsToggle(on: boolean): void;
}

export interface ExplorePanelHandle {
  root: HTMLElement;
  showOrgan(info: { label: string; description: string } | null): void;
  setActiveLayer(layer: ExploreLayer): void;
  setSkeleton(on: boolean): void;
  setLayerPanelOpen(open: boolean): void;
  isLayerPanelOpen(): boolean;
  setLabels(on: boolean): void;
}

const ICON_HOME = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`;
const ICON_MENU = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;

const LAYERS: readonly { layer: ExploreLayer; label: string }[] = [
  { layer: "all", label: "몸 전체" },
  { layer: "digestive", label: "소화계" },
  { layer: "respiratory", label: "호흡계" },
  { layer: "circulatory", label: "순환계" },
  { layer: "excretory", label: "배설계" },
];

export function createExplorePanel(cb: ExplorePanelCallbacks): ExplorePanelHandle {
  const root = document.createElement("section");
  root.className = "screen screen-explore";
  root.innerHTML = `
    <header class="hud-top glass">
      <button class="btn-icon" data-action="home" aria-label="홈으로 이동">${ICON_HOME}</button>
      <div class="hud-title"><span class="hud-course-name">자유 탐색</span></div>
      <button class="btn-icon layer-toggle" data-action="toggle-layer" aria-label="계통 패널 열기 닫기">${ICON_MENU}</button>
    </header>

    <aside class="layer-panel glass" aria-label="표시할 계통 선택">
      <h3 class="panel-title">몸속 계통</h3>
      <div class="chip-group">
        ${LAYERS.map((l) => `<button class="chip" data-layer="${l.layer}" aria-pressed="false">${l.label}</button>`).join("")}
      </div>
      <h3 class="panel-title">골격</h3>
      <div class="chip-group">
        <button class="chip" data-skeleton="on" aria-pressed="false">뼈대 보이기</button>
      </div>
      <label class="opacity-row">
        <span>투명도</span>
        <input class="opacity-slider" type="range" min="10" max="100" value="100" aria-label="계통 투명도" />
      </label>
      <button class="chip chip-wide" data-labels aria-pressed="false">기관 라벨</button>
    </aside>

    <aside class="organ-card glass" data-role="organ-card" hidden>
      <h3 class="organ-name"></h3>
      <p class="organ-desc"></p>
      <button class="btn btn-ghost organ-close" data-action="close-organ">닫기</button>
    </aside>`;

  const layerPanel = requireEl<HTMLElement>(root, ".layer-panel");
  const organCard = requireEl<HTMLElement>(root, '[data-role="organ-card"]');
  const organName = requireEl<HTMLElement>(root, ".organ-name");
  const organDesc = requireEl<HTMLElement>(root, ".organ-desc");
  const skeletonChip = requireEl<HTMLButtonElement>(root, "[data-skeleton]");
  const labelsChip = requireEl<HTMLButtonElement>(root, "[data-labels]");
  const opacitySlider = requireEl<HTMLInputElement>(root, ".opacity-slider");
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>(".layer-panel [data-layer]"));

  root.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-action],[data-layer],[data-skeleton],[data-labels]") : null;
    if (target === null) return;
    const action = target.dataset.action;
    if (action === "home") cb.onHome();
    else if (action === "toggle-layer") cb.onToggleLayerPanel();
    else if (action === "close-organ") showOrgan(null);
    else if (target.dataset.labels !== undefined) {
      const on = labelsChip.getAttribute("aria-pressed") !== "true";
      labelsChip.setAttribute("aria-pressed", on ? "true" : "false");
      labelsChip.classList.toggle("active", on);
      cb.onLabelsToggle(on);
    } else if (target.dataset.layer !== undefined) {
      const layer = LAYERS.find((l) => l.layer === target.dataset.layer)?.layer;
      if (layer !== undefined) cb.onLayerSelect(layer);
    } else if (target.dataset.skeleton !== undefined) {
      cb.onSkeletonToggle(skeletonChip.getAttribute("aria-pressed") !== "true");
    }
  });

  function showOrgan(info: { label: string; description: string } | null): void {
    if (info === null) {
      organCard.hidden = true;
      return;
    }
    organName.textContent = info.label;
    organDesc.textContent = info.description;
    organCard.hidden = false;
  }

  function setActiveLayer(layer: ExploreLayer): void {
    for (const chip of chips) {
      const active = chip.dataset.layer === layer;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function setSkeleton(on: boolean): void {
    skeletonChip.classList.toggle("active", on);
    skeletonChip.setAttribute("aria-pressed", on ? "true" : "false");
    skeletonChip.textContent = on ? "뼈대 숨기기" : "뼈대 보이기";
  }

  function setLabels(on: boolean): void {
    labelsChip.classList.toggle("active", on);
    labelsChip.setAttribute("aria-pressed", on ? "true" : "false");
  }

  opacitySlider.addEventListener("input", () => {
    cb.onOpacityChange(Number.parseInt(opacitySlider.value, 10) / 100);
  });

  function setLayerPanelOpen(open: boolean): void {
    layerPanel.classList.toggle("layer-open", open);
  }

  function isLayerPanelOpen(): boolean {
    return layerPanel.classList.contains("layer-open");
  }

  return { root, showOrgan, setActiveLayer, setSkeleton, setLayerPanelOpen, isLayerPanelOpen, setLabels };
}

function requireEl<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (el === null) throw new Error(`ExplorePanel: 요소를 찾을 수 없음 — ${selector}`);
  return el;
}
