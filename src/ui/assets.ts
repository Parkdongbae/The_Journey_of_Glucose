/// <reference types="vite/client" />
/**
 * 아이콘(인라인 SVG)과 학습 삽화(src/assets/figures/*.webp) 모음.
 * 삽화는 scripts/optimize-images.mjs가 images/ 원본에서 만든다.
 */

const figureModules = import.meta.glob<string>("../assets/figures/*.webp", { eager: true, import: "default" });

const FIGURES: Record<string, string> = {};
for (const [path, url] of Object.entries(figureModules)) {
  const key = path.slice(path.lastIndexOf("/") + 1).replace(/\.webp$/, "");
  FIGURES[key] = url;
}

export function figureUrl(key: string): string {
  return FIGURES[key] ?? "";
}

const svg = (body: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', 18),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 18),
  check: svg('<path d="M5 12.5 10 17 19 7.5"/>', 16),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 14),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18),
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 18),
  up: svg('<path d="M6 15l6-6 6 6"/>', 18),
  down: svg('<path d="M6 9l6 6 6-6"/>', 18),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  expand: svg('<path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/>', 16),
  quiz: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h0"/>', 18),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.300 1 2.100h5c0-.8.4-1.600 1-2.100A6 6 0 0 0 12 3z"/>', 18),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="m15.500 8.500-2 5-5 2 2-5z"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M9 17h6"/>'),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>', 16),
  pointer: svg('<path d="M9 11V5a1.500 1.500 0 0 1 3 0v5l5.500 1.200a2 2 0 0 1 1.500 2.300l-.8 4A3 3 0 0 1 15.300 20H12a3 3 0 0 1-2.400-1.200L6 14l1-1a1.500 1.500 0 0 1 2 0z"/>', 18),
} as const;
