import { createScene } from "./3d";
import { mountApp } from "./ui/app";

const app =
  document.querySelector<HTMLDivElement>("#app") ??
  document.body.appendChild(Object.assign(document.createElement("div"), { id: "app" }));
app.style.cssText = "width:100vw;height:100dvh;margin:0;overflow:hidden";
document.body.style.cssText = "margin:0;overflow:hidden";

const scene = createScene(app);
mountApp(app, scene);

// QA용 디버그 핸들 (기능에 영향 없음)
(window as unknown as { __scene: unknown }).__scene = scene;
