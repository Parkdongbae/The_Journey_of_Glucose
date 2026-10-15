/** vite ?url asset imports (skeleton.glb 등 바이너리 에셋) */
declare module "*.glb?url" {
  const src: string;
  export default src;
}
