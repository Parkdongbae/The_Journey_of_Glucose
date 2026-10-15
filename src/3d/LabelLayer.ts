import { Vector3, type Camera } from "three";
import type { OrganRecord } from "./BodyBuilder";
import { organLabel } from "../data/organs";

const LABEL_IDS = [
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
  "thighCell",
] as const;

const PROJECTED = new Vector3();

/** 주요 기관 이름 칩을 화면 좌표에 띄우는 Zygote식 라벨 레이어 (DOM 기반). */
export class LabelLayer {
  readonly dom: HTMLDivElement;
  private entries: { id: string; el: HTMLDivElement; rec: OrganRecord }[] = [];
  private visible = false;

  constructor(private camera: Camera, records: Map<string, OrganRecord>) {
    this.dom = document.createElement("div");
    this.dom.className = "label3d-layer";
    this.dom.setAttribute("aria-hidden", "true");
    for (const id of LABEL_IDS) {
      const rec = records.get(id);
      if (!rec) continue;
      const el = document.createElement("div");
      el.className = "organ-label3d";
      el.textContent = organLabel(id);
      el.style.display = "none";
      this.dom.appendChild(el);
      this.entries.push({ id, el, rec });
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.dom.style.display = on ? "block" : "none";
    if (!on) for (const e of this.entries) e.el.style.display = "none";
  }

  update(): void {
    if (!this.visible) return;
    for (const e of this.entries) {
      let show = e.rec.group.visible && e.rec.fade > 0.5;
      if (show) {
        e.rec.group.getWorldPosition(PROJECTED);
        PROJECTED.project(this.camera);
        if (PROJECTED.z > 1 || PROJECTED.x < -1.05 || PROJECTED.x > 1.05 || PROJECTED.y < -1.05 || PROJECTED.y > 1.05) {
          show = false;
        } else {
          e.el.style.left = `${((PROJECTED.x + 1) / 2) * 100}%`;
          e.el.style.top = `${((-PROJECTED.y + 1) / 2) * 100}%`;
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
