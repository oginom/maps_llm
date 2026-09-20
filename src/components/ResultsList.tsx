import { Box, List, ListItem, ListItemButton, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import {
  getRatingColor,
  resultState,
  stateLabels,
  type SearchResult,
} from "@/lib/place-result";

export function ResultsList({
  results,
  selectedPlace,
  onSelect,
}: {
  results: SearchResult[];
  selectedPlace: string | null;
  onSelect: (id: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Scroll only the list, never the page or the fixed search controls.
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (row && list.current)
      list.current.scrollTop = row.parentElement!.offsetTop;
  }, [selectedPlace]);
  return (
    <List
      ref={list}
      aria-label="候補一覧"
      disablePadding
      sx={{
        overflowY: "auto",
        minHeight: 0,
        flex: 1,
        position: "relative",
        overscrollBehavior: "contain",
      }}
    >
      {results.map((result, index) => (
        <ListItem key={result.placeId} disablePadding>
          <ListItemButton
            component="button"
            data-result-id={result.placeId}
            data-fetch-state={resultState(result)}
            selected={selectedPlace === result.placeId}
            aria-pressed={selectedPlace === result.placeId}
            onClick={() => onSelect(result.placeId)}
            sx={{
              width: "100%",
              textAlign: "left",
              alignItems: "center",
              gap: 1,
              py: 1,
              px: 1.5,
              borderBottom: "1px solid #edf0f3",
              borderLeft:
                selectedPlace === result.placeId
                  ? "4px solid #1976d2"
                  : "4px solid transparent",
            }}
          >
            <Box sx={{ minWidth: 24, color: "text.secondary", fontSize: 12 }}>
              {index + 1}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
              >
                {result.name}
              </Typography>
              <Typography
                variant="caption"
                color={
                  resultState(result) === "failed" ? "error" : "text.secondary"
                }
              >
                {stateLabels[resultState(result)]} · Google ★{" "}
                {result.rating ?? "—"}
              </Typography>
            </Box>
            <Box
              data-score={result.value ?? ""}
              sx={{
                borderRadius: 1,
                px: 0.75,
                py: 0.25,
                fontSize: 12,
                whiteSpace: "nowrap",
                bgcolor: result.value
                  ? getRatingColor(result.value, true)
                  : "#f0f2f4",
                color: "#111",
              }}
            >
              {result.value ? `${result.value}/5` : "—"}
            </Box>
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );
}
