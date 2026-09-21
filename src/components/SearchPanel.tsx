import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { Histogram } from "./Histogram";
import { PlaceDetails } from "./PlaceDetails";
import { ResultsList } from "./ResultsList";
import { resultState, type SearchResult } from "@/lib/place-result";
import { MAX_DETAILS_PER_SEARCH } from "@/lib/place-detail-batch";

type Props = {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  evaluation: string;
  setEvaluation: (value: string) => void;
  onSearch: () => void;
  searchDisabled: boolean;
  isSearching: boolean;
  isLoadingDetails: boolean;
  requestedDetails: number;
  remainingDetails: number;
  searchError: string | null;
  // Explanation shown when the month or session budget is exhausted; search
  // and "next 5" stay disabled while it is set.
  budgetStop: string | null;
  results: SearchResult[];
  selectedPlace: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onMore: () => void;
  onInputFocus: () => void;
};
export function SearchPanel(props: Props) {
  const { results, selectedPlace } = props;
  const selected = results.find((result) => result.placeId === selectedPlace);
  const evaluated = results.filter(
    (result) => resultState(result) === "evaluated",
  ).length;
  const failures = results.filter(
    (result) => resultState(result) === "failed",
  ).length;
  return (
    <>
      <Box
        data-panel-header
        sx={{
          flexShrink: 0,
          maxHeight: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
          p: 1.5,
          pb: 1,
          pt: { xs: 0.5, md: 2 },
          borderBottom: "1px solid #e0e5ea",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        }}
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!props.searchDisabled) props.onSearch();
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing || event.keyCode === 229)
            )
              event.preventDefault();
          }}
          sx={{ display: "flex", flexDirection: "column", gap: 1 }}
        >
          <TextField
            label="検索ワード"
            placeholder="Enter search term"
            size="small"
            fullWidth
            value={props.searchTerm}
            onChange={(event) => props.setSearchTerm(event.target.value)}
            onFocus={props.onInputFocus}
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              label="評価条件"
              placeholder="Enter evaluation"
              size="small"
              fullWidth
              value={props.evaluation}
              onChange={(event) => props.setEvaluation(event.target.value)}
              onFocus={props.onInputFocus}
            />
            <Button
              type="submit"
              aria-label="search"
              variant="contained"
              disableElevation
              disabled={props.searchDisabled}
              sx={{ flexShrink: 0 }}
            >
              検索
            </Button>
          </Box>
        </Box>
        <Box
          role="status"
          aria-live={
            props.isSearching || props.isLoadingDetails ? "off" : "polite"
          }
          aria-busy={props.isSearching || props.isLoadingDetails}
          sx={{ mt: 1 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>
            {props.isSearching
              ? "検索中..."
              : `評価済み ${evaluated} 件 / 最大${MAX_DETAILS_PER_SEARCH}件 · 追加可能 ${props.remainingDetails} 件 · 失敗 ${failures} 件${props.isLoadingDetails ? "・評価中..." : ""}`}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 11 }}
          >
            口コミ取得対象 {props.requestedDetails} 件 / 最大
            {MAX_DETAILS_PER_SEARCH}件 · 候補 {results.length} 件
          </Typography>
        </Box>
        {props.searchError && (
          <Alert
            severity="warning"
            sx={{
              mt: 0.5,
              py: 0,
              px: 1,
              fontSize: 12,
              "& .MuiAlert-message": { overflowWrap: "anywhere" },
            }}
          >
            {props.searchError}
          </Alert>
        )}
        {props.budgetStop && (
          <Typography
            data-budget-stop
            variant="caption"
            color="error"
            sx={{ display: "block", mt: 0.5, fontWeight: 600 }}
          >
            {props.budgetStop}
          </Typography>
        )}
        {props.remainingDetails > 0 && (
          <Button
            size="small"
            variant="outlined"
            fullWidth
            sx={{ mt: 0.75, minHeight: 36 }}
            disabled={
              props.isSearching ||
              props.isLoadingDetails ||
              props.budgetStop !== null
            }
            onClick={props.onMore}
          >
            次の{Math.min(5, props.remainingDetails)}件を評価
          </Button>
        )}
        {results.length > 0 &&
          props.remainingDetails === 0 &&
          !props.isLoadingDetails && (
            <Typography variant="caption" color="text.secondary">
              {props.requestedDetails >= MAX_DETAILS_PER_SEARCH
                ? "この検索の取得上限に達しました（失敗も含む）。"
                : "取得可能な候補をすべて確認しました。"}
            </Typography>
          )}
        <Typography
          data-attribution
          variant="caption"
          sx={{ display: "block", fontWeight: 700, color: "#475569", mt: 0.5 }}
        >
          Google Maps
        </Typography>
      </Box>
      <Box
        data-panel-body
        onKeyDown={(event) => {
          if (event.key === "Escape" && selected) {
            event.stopPropagation();
            props.onClose();
          }
        }}
        sx={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          pb: "env(safe-area-inset-bottom)",
        }}
      >
        {results.length ? (
          <>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                flex: selected ? "0 1 110px" : 1,
              }}
            >
              <ResultsList
                results={results}
                selectedPlace={selectedPlace}
                onSelect={props.onSelect}
              />
            </Box>
            {selected && (
              <PlaceDetails result={selected} onClose={props.onClose} />
            )}
            <Histogram results={results} />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            場所と条件を入力して、候補を地図で比較できます。
          </Typography>
        )}
      </Box>
    </>
  );
}
