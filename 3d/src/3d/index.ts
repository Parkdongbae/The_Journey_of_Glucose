import { Vector3 } from "three";
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
} from "../types";

export type { Scene } from "../types";

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
  void rig.load(body).then(() => {
    if (rig.skeletonRoot.parent === null) mgr.scene.add(rig.skeletonRoot);
    rig.setSkeletonVisible(skeletonVisible);
  });
  mgr.registerUpdater(() => labels.update());

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
      highlighter.highlight(organIds);
    },
    clearHighlight(): void {
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
      const pos = new Vector3();
      await mgr.flyThroughOrganIds((id) => body.getOrganWorldPosition(id, pos), organIds, perStopSec);
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
    setSkeletonVisible(on: boolean): void {
      skeletonVisible = on;
      rig.setSkeletonVisible(on);
    },
    setLabelsVisible(on: boolean): void {
      labels.setVisible(on);
    },
    onHoverChange(cb: (organId: string | null) => void): void {
      highlighter.onHoverChange(cb);
    },
    onEmptyClick(cb: () => void): void {
      highlighter.onEmptyClick(cb);
    },
  };
}
