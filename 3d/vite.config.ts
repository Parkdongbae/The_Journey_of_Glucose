import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 단일 HTML 파일로 빌드 (three.js 내장) → dist/index.html을 더블클릭으로 실행 가능
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  server: {
    fs: { allow: ["..", "../images"] },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    reportCompressedSize: false,
  },
});
