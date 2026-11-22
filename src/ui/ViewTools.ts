/**
 * 보기 설정 팝오버 — 수업·자유 탐색 화면이 함께 쓰는 3D 표시 도구.
 * 계통 선택, 이름표·뼈대 토글, 투명도, 화면 품질, 테마.
 * 필요할 때만 열리고, 바깥을 누르거나 Esc를 누르면 닫힌다.
 */
import { SYSTEM_LABELS, type SystemName, type ThemeName } from "../types";
import { ICON } from "./assets";

export type LayerSelection = "all" | SystemName;

export interface ViewToolsCallbacks {
  onLayerSelect(layer: LayerSelection): void;
  onLabelsToggle(on: boolean): void;
  onSkeletonToggle(on: boolean): void;
  onOpacityChange(opacity: number): void;
  onQualityChange(level: "low" | "high"): void;
  onThemeChange(theme: ThemeName): void;
}

export interface ViewToolsState {
  layer: LayerSelection;
  labels: boolean;
  skeleton: boolean;
  quality: "low" | "high";
  theme: ThemeName;
}

export interface ViewToolsHandle {
  /** 상단 바에 넣을 버튼 */
  button: HTMLButtonElement;
  /** 화면 섹션에 붙일 팝오버 */
  popover: HTMLElement;
  update(state: ViewToolsState): void;
  close(): void;
}

const LAYERS: readonly { layer: LayerSelection; label: string }[] = [
  { layer: "all", label: "전체" },
  { layer: "digestive", label: SYSTEM_LABELS.digestive },
  { layer: "respiratory", label: SYSTEM_LABELS.respiratory },
  { layer: "circulatory", label: SYSTEM_LABELS.circulatory },
  { layer: "excretory", label: SYSTEM_LABELS.excretory },
];

export function createViewTools(cb: ViewToolsCallbacks): ViewToolsHandle {
  const button = document.createElement("button");
  button.className = "btn-icon";
  button.type = "button";
  button.setAttribute("aria-label", "보기 설정");
  button.setAttribute("aria-expanded", "false");
  button.title = "보기 설정";
  button.innerHTML = ICON.sliders;

  const popover = document.createElement("div");
  popover.className = "popover tools-popover panel";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "보기 설정");
  popover.innerHTML = `
    <div class="tools-group">
      <h3 class="tools-title">기관계</h3>
      <div class="seg" data-role="layers">
        ${LAYERS.map((l) => `<button type="button" class="seg-btn" data-layer="${l.layer}" aria-pressed="false">${l.label}</button>`).join("")}
      </div>
    </div>
    <div class="tools-group tools-row">
      <label class="switch"><input type="checkbox" data-toggle="labels" /><span class="switch-ui"></span>기관 이름표</label>
      <label class="switch"><input type="checkbox" data-toggle="skeleton" /><span class="switch-ui"></span>뼈대</label>
    </div>
    <div class="tools-group">
      <label class="tools-title" for="tools-opacity">기관 투명도</label>
      <input id="tools-opacity" class="slider" type="range" min="15" max="100" value="100" />
    </div>
    <div class="tools-group tools-row">
      <div>
        <h3 class="tools-title">화면 품질</h3>
        <div class="seg">
          <button type="button" class="seg-btn" data-quality="high" aria-pressed="false">높음</button>
          <button type="button" class="seg-btn" data-quality="low" aria-pressed="false">낮음</button>
        </div>
      </div>
      <div>
        <h3 class="tools-title">테마</h3>
        <div class="seg">
          <button type="button" class="seg-btn" data-theme-pick="dark" aria-pressed="false">${ICON.moon}<span class="sr-only">어두운 테마</span></button>
          <button type="button" class="seg-btn" data-theme-pick="light" aria-pressed="false">${ICON.sun}<span class="sr-only">밝은 테마</span></button>
        </div>
      </div>
    </div>`;

  const slider = popover.querySelector<HTMLInputElement>(".slider");
  const labelsInput = popover.querySelector<HTMLInputElement>('[data-toggle="labels"]');
  const skeletonInput = popover.querySelector<HTMLInputElement>('[data-toggle="skeleton"]');

  function setOpen(open: boolean): void {
    popover.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.classList.toggle("is-active", open);
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(popover.hidden);
  });
  document.addEventListener("pointerdown", (e) => {
    if (popover.hidden) return;
    const t = e.target;
    if (t instanceof Node && (popover.contains(t) || button.contains(t))) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popover.hidden) setOpen(false);
  });

  popover.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-layer],[data-quality],[data-theme-pick]") : null;
    if (t === null) return;
    const layer = LAYERS.find((l) => l.layer === t.dataset.layer)?.layer;
    if (layer !== undefined) cb.onLayerSelect(layer);
    const q = t.dataset.quality;
    if (q === "low" || q === "high") cb.onQualityChange(q);
    const th = t.dataset.themePick;
    if (th === "dark" || th === "light") cb.onThemeChange(th);
  });
  labelsInput?.addEventListener("change", () => cb.onLabelsToggle(labelsInput.checked));
  skeletonInput?.addEventListener("change", () => cb.onSkeletonToggle(skeletonInput.checked));
  slider?.addEventListener("input", () => cb.onOpacityChange(Number.parseInt(slider.value, 10) / 100));

  function press(selector: string, attr: string, value: string): void {
    for (const el of popover.querySelectorAll<HTMLElement>(selector)) {
      const on = el.dataset[attr] === value;
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function update(s: ViewToolsState): void {
    press("[data-layer]", "layer", s.layer);
    press("[data-quality]", "quality", s.quality);
    press("[data-theme-pick]", "themePick", s.theme);
    if (labelsInput) labelsInput.checked = s.labels;
    if (skeletonInput) skeletonInput.checked = s.skeleton;
  }

  return { button, popover, update, close: () => setOpen(false) };
}
