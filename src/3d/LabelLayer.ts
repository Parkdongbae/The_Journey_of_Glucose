import { Vector3, type Camera } from "three";
import type { OrganRecord } from "./BodyBuilder";
import { ORGAN_MAP, organLabel } from "../data/organs";

/** "기관 라벨" 토글을 켰을 때 보이는 주요 기관 */
const MAJOR_IDS = new Set([
  "mouth",
  "nasal",
  "trachea",
  "lungs",
  "heart",
  "liver",
  "stomach",
  "smallIntestine",
  "largeIntestine",
  "kidneys",
  "bladder",
]);

/** 좌우 한 쌍이거나 길쭉한 기관은 중심이 엉뚱한 곳에 오므로 이름표 기준점을 옮긴다 */
const ANCHOR_OFFSET: Partial<Record<string, [number, number, number]>> = {
  lungs: [0.7, 0.35, 0.3],
  kidneys: [0.56, 0.15, 0],
  ureters: [0.45, -0.4, 0],
  aorta: [0, 0.6, 0],
  venaCava: [0, -0.2, 0],
  esophagus: [0, 0.5, 0],
  largeIntestine: [1.1, 0.3, 0.15],
  bronchi: [0.5, 0.35, 0],
  diaphragm: [0.6, 0.6, 0.5],
};
const P = new Vector3();

/** 기관 이름표를 화면 좌표에 띄우는 DOM 레이어. 초점 기관은 토글과 무관하게 항상 표시된다. */
export class LabelLayer {
  readonly dom: HTMLDivElement;
  private entries: { id: string; el: HTMLDivElement; rec: () => OrganRecord | undefined }[] = [];
  private allOn = false;
  private focus = new Set<string>();

  constructor(private camera: Camera, records: Map<string, OrganRecord>) {
    this.dom = document.createElement("div");
    this.dom.className = "label3d-layer";
    this.dom.setAttribute("aria-hidden", "true");
    for (const id of ORGAN_MAP.keys()) {
      const el = document.createElement("div");
      el.className = "organ-label3d";
      el.textContent = organLabel(id);
      el.style.display = "none";
      this.dom.appendChild(el);
      // 실제 메시로 교체되면 레코드가 바뀌므로 매번 조회한다
      this.entries.push({ id, el, rec: () => records.get(id) });
    }
  }

  setVisible(on: boolean): void {
    this.allOn = on;
  }

  setFocus(ids: string[]): void {
    this.focus = new Set(ids);
    for (const e of this.entries) e.el.classList.toggle("is-focus", this.focus.has(e.id));
  }

  update(): void {
    for (const e of this.entries) {
      const rec = e.rec();
      const wanted = this.focus.has(e.id) || (this.allOn && MAJOR_IDS.has(e.id));
      let show = wanted && rec !== undefined && rec.group.visible && rec.fade > 0.5 && !rec.dim;
      if (show) {
        const meta = ORGAN_MAP.get(e.id);
        const off = ANCHOR_OFFSET[e.id] ?? [0, 0, 0];
        P.set((meta?.position.x ?? 0) + off[0], (meta?.position.y ?? 0) + off[1], (meta?.position.z ?? 0) + off[2]);
        P.project(this.camera);
        if (P.z > 1 || P.x < -1.02 || P.x > 1.02 || P.y < -1.02 || P.y > 1.02) {
          show = false;
        } else {
          e.el.style.left = `${((P.x + 1) / 2) * 100}%`;
          e.el.style.top = `${((-P.y + 1) / 2) * 100}%`;
        }
      }
      e.el.style.display = show ? "flex" : "none";
    }
  }

  attach(parent: HTMLElement): void {
    parent.appendChild(this.dom);
  }

  dispose(): void {
    this.dom.remove();
    this.entries = [];
  }
}
