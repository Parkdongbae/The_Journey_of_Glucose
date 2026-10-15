import { BackSide, Color, Group, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector2, type Camera } from "three";
import type { OrganRecord } from "./BodyBuilder";

const HOVER_EMISSIVE = 0.25;
const HIGHLIGHT_EMISSIVE = 0.5;
const CLICK_MOVE_PX = 6;
const HOVER_INTERVAL = 0.06;
const OUTLINE_HOVER = 0xffffff;
const OUTLINE_FOCUS = 0xffd166;
const OUTLINE_SCALE = 1.035;

/** 강조/딤/펄스/윤곽선/레이캐스트 클릭·호버 전담. 불투명도 계산은 BodyBuilder.refreshOpacity에 위임. */
export class OrganHighlighter {
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private highlighted = new Set<string>();
  private pulsing = new Set<string>();
  private hovered: string | null = null;
  private interactive = false;
  private callback: ((organId: string) => void) | null = null;
  private emptyCallback: (() => void) | null = null;
  private hoverCallback: ((organId: string | null) => void) | null = null;
  private downPos: { x: number; y: number } | null = null;
  private hoverClock = 0;
  private clock = 0;
  private white = new Color(0xffffff);
  private pulseColor = new Color(0xfff1a0);
  private tmpColor = new Color();
  private outlines = new Map<string, { group: Group; mat: MeshBasicMaterial }>();

  constructor(
    private camera: Camera,
    private dom: HTMLElement,
    private records: Map<string, OrganRecord>,
    private refreshOpacity: (rec: OrganRecord) => void,
    private collectMeshes: () => Mesh[],
  ) {
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerleave", this.onLeave);
  }

  // ------------------------------------------------------------------- public

  onOrganClick(cb: (organId: string) => void): void {
    this.callback = cb;
  }

  onHoverChange(cb: (organId: string | null) => void): void {
    this.hoverCallback = cb;
  }

  onEmptyClick(cb: () => void): void {
    this.emptyCallback = cb;
  }

  setInteractivity(enabled: boolean): void {
    this.interactive = enabled;
    if (!enabled) this.setHovered(null);
  }

  highlight(organIds: string[]): void {
    this.highlighted = new Set(organIds);
    this.refreshAll();
  }

  clearHighlight(): void {
    this.highlighted.clear();
    this.refreshAll();
  }

  pulseOrgan(organId: string, on: boolean): void {
    if (on) {
      this.pulsing.add(organId);
    } else {
      this.pulsing.delete(organId);
      this.resetVisual(organId);
    }
  }

  update(dt: number): void {
    this.clock += dt;
    // 강조 펄스 스케일 (±4%, 1.2s)
    for (const id of this.highlighted) {
      const rec = this.records.get(id);
      if (!rec) continue;
      const s = 1 + 0.04 * Math.sin((Math.PI * 2 * this.clock) / 1.2);
      rec.group.scale.setScalar(s);
    }
    // 퀴즈 옵션 펄스 (1s 주기 강한 emissive)
    for (const id of this.pulsing) {
      const rec = this.records.get(id);
      if (!rec) {
        this.pulsing.delete(id);
        continue;
      }
      const wave = 0.5 + 0.5 * Math.sin(Math.PI * 2 * this.clock);
      this.applyEmissive(rec, this.pulseColor, 0.35 + 0.55 * wave);
    }
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerleave", this.onLeave);
  }

  // ------------------------------------------------------------------ visuals

  private refreshAll(): void {
    for (const rec of this.records.values()) {
      rec.dim = this.highlighted.size > 0 && !this.highlighted.has(rec.id);
      this.refreshOpacity(rec);
      this.resetVisual(rec.id);
    }
  }

  private resetVisual(organId: string): void {
    const rec = this.records.get(organId);
    if (!rec) return;
    rec.group.scale.setScalar(1);
    if (this.pulsing.has(organId)) return; // 펄스는 update가 매 프레임 덮어씀
    if (this.highlighted.has(organId)) {
      this.applyEmissive(rec, this.tmpColor.copy(rec.baseColors[0] ?? this.white).lerp(this.white, 0.55), HIGHLIGHT_EMISSIVE);
      this.showOutline(organId, OUTLINE_FOCUS);
    } else if (this.hovered === organId) {
      this.applyEmissive(rec, rec.baseColors[0] ?? this.white, HOVER_EMISSIVE);
      this.showOutline(organId, OUTLINE_HOVER);
    } else {
      this.applyEmissive(rec, this.black, 1);
      this.showOutline(organId, null);
    }
  }

  /** 역면 셸 방식 윤곽선. 색 null이면 숨김. hover/강조에만 생성되어 캐시된다. */
  private showOutline(organId: string, color: number | null): void {
    if (color === null) {
      const existing = this.outlines.get(organId);
      if (existing) existing.group.visible = false;
      return;
    }
    let entry = this.outlines.get(organId);
    if (!entry) {
      const rec = this.records.get(organId);
      if (!rec) return;
      const group = new Group();
      const mat = new MeshBasicMaterial({ side: BackSide, color, toneMapped: false, transparent: true, opacity: 0.9 });
      for (const mesh of rec.meshes) {
        const shell = mesh.clone();
        shell.material = mat;
        shell.scale.multiplyScalar(OUTLINE_SCALE);
        shell.userData.organId = organId;
        shell.renderOrder = 1;
        group.add(shell);
      }
      rec.group.add(group);
      entry = { group, mat };
      this.outlines.set(organId, entry);
    }
    entry.mat.color.setHex(color);
    entry.group.visible = true;
  }

  private black = new Color(0x000000);

  private applyEmissive(rec: OrganRecord, color: Color, intensity: number): void {
    for (const mat of rec.materials) {
      mat.emissive.copy(color);
      mat.emissiveIntensity = intensity;
    }
  }

  private setHovered(organId: string | null): void {
    if (this.hovered === organId) return;
    const prev = this.hovered;
    this.hovered = organId;
    if (prev) this.resetVisual(prev);
    if (organId) this.resetVisual(organId);
    this.dom.style.cursor = organId ? "pointer" : "";
    this.hoverCallback?.(organId);
  }

  // ----------------------------------------------------------------- raycast

  /** 화소 오프셋 목록: 중심 1회 + 주변 24회 (얇은 혈관 클릭 관용) */
  private static readonly FAN_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
    const out: Array<readonly [number, number]> = [];
    for (const dx of [-12, -6, 0, 6, 12]) {
      for (const dy of [-12, -6, 0, 6, 12]) out.push([dx, dy] as const);
    }
    return out;
  })();

  private pickNdc(e: PointerEvent, dxPx: number, dyPx: number): void {
    const rect = this.dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.pointer.set(
      ((e.clientX + dxPx - rect.left) / rect.width) * 2 - 1,
      -((e.clientY + dyPx - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private organIdOfHit(object: Object3D): string | null {
    let cur: Object3D | null = object;
    while (cur) {
      const id = cur.userData.organId;
      if (typeof id === "string") return id;
      cur = cur.parent;
    }
    return null;
  }

  private targets(): Mesh[] {
    return this.collectMeshes().filter((m) => m.visible);
  }

  private pick(e: PointerEvent, favorPulsing = false): string | null {
    const targets = this.targets();
    if (targets.length === 0) return null;
    const first = this.pickFirst(e, targets);
    if (favorPulsing && (first === null || !this.pulsing.has(first))) {
      const pulsing = this.pickPulsingAround(e, targets);
      if (pulsing !== null) return pulsing;
    }
    return first;
  }

  private pickFirst(e: PointerEvent, targets: Mesh[]): string | null {
    this.pickNdc(e, 0, 0);
    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits[0];
    return hit ? this.organIdOfHit(hit.object) : null;
  }

  /** 클릭점 주변 25지점 레이캐스트에서 펄스 중인(퀴즈 보기) 기관을 최우선 판정 */
  private pickPulsingAround(e: PointerEvent, targets: Mesh[]): string | null {
    for (const [dx, dy] of OrganHighlighter.FAN_OFFSETS) {
      this.pickNdc(e, dx, dy);
      const hits = this.raycaster.intersectObjects(targets, false);
      for (const hit of hits.slice(0, 6)) {
        const id = this.organIdOfHit(hit.object);
        if (id !== null && this.pulsing.has(id)) return id;
      }
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent): void => {
    const down = this.downPos;
    this.downPos = null;
    if (!down || !this.interactive) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MOVE_PX) return; // 궤도 드래그 무시
    const id = this.pick(e, true);
    if (id !== null) {
      this.callback?.(id);
    } else {
      this.emptyCallback?.();
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.interactive) return;
    if (this.clock - this.hoverClock < HOVER_INTERVAL) return;
    this.hoverClock = this.clock;
    this.setHovered(this.pick(e));
  };

  private onLeave = (): void => {
    this.setHovered(null);
  };
}
