import { Box3, Vector3 } from "three";
import { AnatomyRig } from "./AnatomyRig";
import { BodyBuilder } from "./BodyBuilder";
import { FxLayer } from "./FxLayer";
import { LabelLayer } from "./LabelLayer";
import { OrganHighlighter } from "./OrganHighlighter";
import { PathAnimator } from "./PathAnimator";
import { SceneManager } from "./SceneManager";
import type {
  CameraView,
  CharacterType,
  FxSpec,
  PathDef,
  Scene,
  SceneApi,
  SystemName,
  ThemeName,
  ViewInsets,
} from "../types";

export type { Scene } from "../types";

/** 기관 크기에 맞춘 근접 거리 (자유 탐색에서 기관을 골랐을 때) */
const FOCUS_DISTANCE: Partial<Record<string, number>> = {
  mouth: 3.2,
  nasal: 3.2,
  gallbladder: 3.2,
  pancreas: 3.6,
  alveoli: 3.0,
  bladder: 3.6,
  thighCell: 4.2,
  aorta: 9,
  venaCava: 9,
  esophagus: 6,
  ureters: 6,
  smallIntestine: 5.4,
  largeIntestine: 6,
  lungs: 6,
  diaphragm: 6,
};

export function createScene(container: HTMLElement): Scene {
  const mgr = new SceneManager(container);
  const body = new BodyBuilder();
  mgr.scene.add(body.root);
  mgr.registerUpdater((dt) => body.update(dt));

  const highlighter = new OrganHighlighter(
    mgr.camera,
    mgr.domElement,
    body.records,
    (rec) => body.refreshOpacity(rec),
    () => {
      const meshes = [];
      for (const rec of body.records.values()) {
        if (!rec.group.visible) continue;
        for (const m of rec.meshes) if (m.visible) meshes.push(m);
      }
      return meshes;
    },
  );
  mgr.registerUpdater((dt) => highlighter.update(dt));

  const pathAnimator = new PathAnimator(mgr.scene, mgr.camera);
  mgr.registerUpdater((dt) => pathAnimator.update(dt));

  const fx = new FxLayer(mgr.scene);
  mgr.registerUpdater((dt) => fx.update(dt));

  const labels = new LabelLayer(mgr.camera, body.records);
  labels.attach(container);

  const rig = new AnatomyRig();
  let skeletonVisible = false;
  let skeletonGhost = false;
  const ready = rig
    .load(body)
    .then(() => {
      if (rig.skeletonRoot.parent === null) mgr.scene.add(rig.skeletonRoot);
      rig.setSkeletonVisible(skeletonVisible, skeletonGhost);
      highlighter.rebuild();
    })
    .catch(() => {
      // 실제 메시 로딩 실패 — 절차적 기관으로 계속 동작
    });
  mgr.registerUpdater(() => labels.update());

  const organPos = (id: string): Vector3 | undefined => body.getOrganWorldPosition(id, new Vector3());

  const api: SceneApi = {
    setSystemsVisible(visible: SystemName[]): void {
      body.setSystemsVisible(new Set(visible));
    },
    flyTo(view: CameraView, durationSec?: number): Promise<void> {
      return mgr.flyTo(view, durationSec);
    },
    resetView(durationSec?: number): Promise<void> {
      return mgr.resetView(durationSec);
    },
    highlight(organIds: string[]): void {
      body.setOnDemandVisible(organIds);
      highlighter.highlight(organIds);
    },
    clearHighlight(): void {
      body.setOnDemandVisible([]);
      highlighter.clearHighlight();
    },
    pulseOrgan(organId: string, on: boolean): void {
      highlighter.pulseOrgan(organId, on);
    },
    playPath(def: PathDef, character: CharacterType, opts: { durationSec: number; loops: number }): Promise<void> {
      return pathAnimator.playPath(def, character, opts);
    },
    stopPath(): void {
      pathAnimator.stopPath();
    },
    async flyThroughOrganIds(organIds: string[], perStopSec: number): Promise<void> {
      await mgr.flyThroughOrganIds(organPos, organIds, perStopSec, (id) => {
        body.setOnDemandVisible([id]);
        highlighter.highlight([id]);
        labels.setFocus([id]);
      });
    },
    spawnFx(fxSpec: FxSpec): void {
      fx.spawnFx(fxSpec);
    },
    clearFx(): void {
      fx.clearFx();
    },
    setBreathing(on: boolean): void {
      body.setBreathing(on);
    },
    onOrganClick(cb: (organId: string) => void): void {
      highlighter.onOrganClick(cb);
    },
    setOrganInteractivity(enabled: boolean): void {
      highlighter.setInteractivity(enabled);
    },
    isolateOrgans(organIds: string[] | null): void {
      body.isolateOrgans(organIds);
    },
    setSystemOpacity(target: SystemName | "all", opacity: number): void {
      body.setSystemOpacity(target, opacity);
    },
    setQuality(level: "low" | "high"): void {
      mgr.setQuality(level);
    },
    resize(): void {
      mgr.resize();
    },
    dispose(): void {
      highlighter.dispose();
      pathAnimator.dispose();
      fx.dispose();
      labels.dispose();
      mgr.dispose();
    },
  };

  return {
    ...api,
    ready,
    setSkeletonVisible(on: boolean, ghost = false): void {
      skeletonVisible = on;
      skeletonGhost = ghost;
      rig.setSkeletonVisible(on, ghost);
    },
    setLabelsVisible(on: boolean): void {
      labels.setVisible(on);
    },
    setFocusLabels(organIds: string[]): void {
      labels.setFocus(organIds);
    },
    focusOrgan(organId: string): Promise<void> {
      const pos = organPos(organId);
      if (pos === undefined) return Promise.resolve();
      return mgr.focusPoint(pos, FOCUS_DISTANCE[organId] ?? 4.6);
    },
    setViewInsets(insets: ViewInsets): void {
      mgr.setViewInsets(insets);
    },
    setTheme(theme: ThemeName): void {
      mgr.setTheme(theme);
      body.setTheme(theme);
    },
    setAutoRotate(on: boolean): void {
      mgr.setAutoRotate(on);
    },
    getQuality(): "low" | "high" {
      return mgr.getQuality();
    },
    debugOrganCenters(): Record<string, [number, number, number]> {
      const out: Record<string, [number, number, number]> = {};
      for (const id of body.records.keys()) {
        const p = organPos(id);
        const rec = body.records.get(id);
        if (p && rec) {
          const b = new Box3().setFromObject(rec.group);
          out[id] = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
          (out as Record<string, number[]>)[id + "_box"] = [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map((n) => +n.toFixed(2));
        }
      }
      return out;
    },
    debugFrameMs(frames?: number): number {
      return mgr.debugFrameMs(frames);
    },
    onHoverChange(cb: (organId: string | null) => void): void {
      highlighter.onHoverChange(cb);
    },
    onEmptyClick(cb: () => void): void {
      highlighter.onEmptyClick(cb);
    },
  };
}
