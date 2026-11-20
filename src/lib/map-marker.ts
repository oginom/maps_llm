import { scoreColor } from "./score-colors";

/** SVG marker artwork is independent of the Maps API and can be swapped locally. */
export function markerSvg(options: {
  value?: number | null;
  selected?: boolean;
  compared?: boolean;
  origin?: boolean;
}): string {
  const { selected, compared, origin } = options;
  const fill = origin ? "#243b35" : scoreColor(options.value);
  const ring = selected ? "#243b35" : compared ? "#bd8a3c" : "#fffdf7";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="54" viewBox="0 0 48 54"><path d="M24 51C21 44 6 33 6 22a18 18 0 1 1 36 0C42 33 27 44 24 51Z" fill="${ring}"/><path d="M24 45C19 38 10 30 10 22a14 14 0 1 1 28 0c0 8-9 16-14 23Z" fill="${fill}" stroke="#243b35" stroke-width="${selected || compared ? 2 : 1}"/>${compared ? '<circle cx="38" cy="8" r="6" fill="#bd8a3c" stroke="#fffdf7" stroke-width="2"/><path d="m35.5 8 1.7 1.7 3.4-3.5" fill="none" stroke="#fff" stroke-width="1.5"/>' : ""}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
