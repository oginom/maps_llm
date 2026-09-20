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
  const drag = useRef<number | null>(null);
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
    const resize = () => {
      root.current?.style.setProperty(
        "--viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      root.current?.style.setProperty(
        "--viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, []);
  return (
    <Box
      ref={root}
      sx={{
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
      <Box data-map-region sx={{ flex: 1, minWidth: 0, minHeight: 64 }}>
        {map}
      </Box>
      <Paper
        component="aside"
        aria-label="検索と店舗情報"
        data-sheet-height={height}
        square
        elevation={3}
        sx={{
          width: { xs: "100%", md: 400 },
          flexShrink: 0,
          minHeight: 0,
          height: {
            xs:
              height === "collapsed"
                ? `${headerHeight + 32}px`
                : height === "half"
                  ? `max(${headerHeight + 140}px, 50%)`
                  : "90%",
            md: "100%",
          },
          maxHeight: { xs: "calc(100% - 64px)", md: "100%" },
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: { xs: "16px 16px 0 0", md: 0 },
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
            drag.current = event.clientY;
            dragged.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (drag.current === null) return;
            const delta = drag.current - event.clientY;
            dragged.current = Math.abs(delta) > 25;
            if (dragged.current)
              onHeightChange(
                heights[
                  Math.max(
                    0,
                    Math.min(2, heights.indexOf(height) + (delta > 0 ? 1 : -1)),
                  )
                ],
              );
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
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
