"use client";

import { Box, Button, Paper } from "@mui/material";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type SheetHeight = "collapsed" | "half" | "full";
const heights: SheetHeight[] = ["collapsed", "half", "full"];

// A non-modal sheet: the map keeps its own visible space and remains interactive.
export function BottomSheet({
  map,
  children,
  height,
  onHeightChange,
  isSearching,
}: {
  map: ReactNode;
  children: ReactNode;
  height: SheetHeight;
  isSearching: boolean;
  onHeightChange: (height: SheetHeight) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const dragged = useRef(false);
  const [headerHeight, setHeaderHeight] = useState(180);
  useEffect(() => {
    const header = root.current?.querySelector("[data-panel-header]");
    if (!header) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeaderHeight(entry.target.getBoundingClientRect().height),
    );
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = root.current;
    if (!element) return;
    let baseline: { height: number; width: number } | null = null;
    let frame = 0;
    const rememberViewport = (event: FocusEvent) => {
      if (
        !baseline &&
        event.target instanceof HTMLInputElement &&
        window.matchMedia("(max-width: 899.95px)").matches
      ) {
        baseline = {
          height: element.getBoundingClientRect().height,
          width: window.innerWidth,
        };
      }
    };
    const resize = () => {
      frame = 0;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      if (baseline?.width !== window.innerWidth) baseline = null;
      const keyboard = baseline && visibleHeight < baseline.height - 1;
      // Keep the map's normal layout/bounds. Only the sheet follows the
      // visual viewport as the keyboard animates or Safari scrolls it.
      element.toggleAttribute("data-keyboard", Boolean(keyboard));
      element.style.setProperty(
        "--viewport-height",
        `${keyboard ? baseline!.height : visibleHeight}px`,
      );
      element.style.setProperty("--viewport-top", `${keyboard ? 0 : top}px`);
      element.style.setProperty("--visible-height", `${visibleHeight}px`);
      element.style.setProperty(
        "--keyboard-bottom",
        `${keyboard ? baseline!.height - visibleHeight - top : 0}px`,
      );
      if (!keyboard && !(document.activeElement instanceof HTMLInputElement))
        baseline = null;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(resize);
    };
    resize();
    element.addEventListener("focusin", rememberViewport);
    element.addEventListener("focusout", schedule);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("focusin", rememberViewport);
      element.removeEventListener("focusout", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, []);
  return (
    <Box
      ref={root}
      sx={{
        "--sheet-height": `min(calc(100% - 64px), var(--drag-height, ${
          height === "collapsed"
            ? `${headerHeight + 32}px`
            : height === "half"
              ? `max(${headerHeight + 140}px, 50%)`
              : "90%"
        }))`,
        "&[data-keyboard] aside": {
          bottom: "var(--keyboard-bottom)",
          height: "calc(var(--visible-height) - min(32px, 5%))",
          maxHeight: "none",
        },
        "&[data-keyboard] aside [data-panel-body]": { display: "flex" },
        position: "fixed",
        top: "var(--viewport-top, 0px)",
        left: 0,
        width: "100%",
        height: "var(--viewport-height, 100dvh)",
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        overflow: "hidden",
        bgcolor: "#eef2f5",
      }}
    >
      <Box
        data-map-region
        sx={{
          flex: { xs: "0 0 calc(100% - var(--sheet-height))", md: 1 },
          minWidth: 0,
          minHeight: 64,
          order: { xs: 0, md: 1 },
        }}
      >
        {map}
      </Box>
      <Paper
        ref={sheet}
        component="aside"
        aria-label="検索と店舗情報"
        data-sheet-height={height}
        square
        elevation={3}
        sx={{
          width: { xs: "100%", md: 420 },
          order: { xs: 1, md: 0 },
          flexShrink: 0,
          minHeight: 0,
          position: { xs: "absolute", md: "static" },
          bottom: 0,
          height: {
            xs: "var(--sheet-height)",
            md: "100%",
          },
          maxHeight: { xs: "calc(100% - 64px)", md: "100%" },
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: { xs: "20px 20px 0 0", md: 0 },
          "& [data-panel-body]": {
            display: {
              xs: height === "collapsed" ? "none" : "flex",
              md: "flex",
            },
          },
        }}
      >
        <Button
          aria-expanded={height !== "collapsed"}
          disabled={isSearching}
          data-sheet-handle
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || !sheet.current)
              return;
            drag.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startHeight: sheet.current.getBoundingClientRect().height,
            };
            dragged.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (
              !current ||
              current.pointerId !== event.pointerId ||
              !root.current
            )
              return;
            const delta = current.startY - event.clientY;
            if (Math.abs(delta) <= 5 && !dragged.current) return;
            dragged.current = true;
            const viewportHeight = root.current.getBoundingClientRect().height;
            const maxHeight = Math.min(
              viewportHeight * 0.9,
              viewportHeight - 64,
            );
            const minHeight = Math.min(headerHeight + 32, maxHeight);
            root.current.style.setProperty(
              "--drag-height",
              `${Math.max(minHeight, Math.min(maxHeight, current.startHeight + delta))}px`,
            );
          }}
          onPointerUp={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            const delta = current.startY - event.clientY;
            if (Math.abs(delta) > 25) dragged.current = true;
            if (Math.abs(delta) > 25)
              onHeightChange(
                heights[
                  Math.max(
                    0,
                    Math.min(2, heights.indexOf(height) + (delta > 0 ? 1 : -1)),
                  )
                ],
              );
            drag.current = null;
            root.current?.style.removeProperty("--drag-height");
          }}
          onPointerCancel={() => {
            drag.current = null;
            dragged.current = false;
            root.current?.style.removeProperty("--drag-height");
          }}
          onLostPointerCapture={() => {
            if (!drag.current) return;
            drag.current = null;
            dragged.current = false;
            root.current?.style.removeProperty("--drag-height");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              onHeightChange(
                heights[
                  Math.max(
                    0,
                    Math.min(
                      2,
                      heights.indexOf(height) +
                        (event.key === "ArrowUp" ? 1 : -1),
                    ),
                  )
                ],
              );
            }
          }}
          onClick={() => {
            if (!dragged.current)
              onHeightChange(heights[(heights.indexOf(height) + 1) % 3]);
            dragged.current = false;
          }}
          sx={{
            display: { xs: "flex", md: "none" },
            minHeight: 32,
            height: 32,
            p: 0,
            flexShrink: 0,
            touchAction: "none",
            color: "text.secondary",
            fontSize: 11,
            gap: 1,
          }}
        >
          <Box
            component="span"
            sx={{ width: 32, height: 4, borderRadius: 2, bgcolor: "#a5b0bb" }}
          />
          {height === "collapsed"
            ? "広げる"
            : height === "half"
              ? "さらに広げる"
              : "地図を見る"}
        </Button>
        {children}
      </Paper>
    </Box>
  );
}
