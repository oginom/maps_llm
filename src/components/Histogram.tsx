import { Box, Typography } from "@mui/material";
import { getRatingColor, type SearchResult } from "@/lib/place-result";

export function Histogram({ results }: { results: SearchResult[] }) {
  const bins = [0, 0, 0, 0, 0];
  results.forEach(({ value }) => {
    if (value && value >= 1 && value <= 5) bins[Math.floor(value) - 1]++;
  });
  return (
    <Box
      aria-label="評価の分布"
      data-histogram
      sx={{ px: 1.5, py: 0.75, borderTop: "1px solid #e0e5ea", flexShrink: 0 }}
    >
      <Typography variant="caption">
        分布 · 条件への評価（1 低 → 5 高）
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, height: 28, alignItems: "end" }}>
        {bins.map((count, index) => (
          <Box
            key={index}
            data-bin={index + 1}
            data-count={count}
            sx={{
              flex: 1,
              textAlign: "center",
              fontSize: 11,
              color: "#111",
              bgcolor: getRatingColor(index + 1, true),
              height: `${18 + (count / Math.max(1, ...bins)) * 10}px`,
              borderRadius: "3px 3px 0 0",
            }}
          >
            {index + 1}: {count}件
          </Box>
        ))}
      </Box>
    </Box>
  );
}
