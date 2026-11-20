import { Box, Button, Link, Typography } from "@mui/material";
import { ReviewEvidence } from "./ReviewEvidence";
import { PlaceQuestions, type PlaceQuestionsProps } from "./PlaceQuestions";
import {
  getRatingColor,
  resultState,
  stateLabels,
  type SearchResult,
} from "@/lib/place-result";

export function PlaceDetails({
  result,
  onClose,
  questions,
}: {
  result: SearchResult;
  onClose: () => void;
  questions: PlaceQuestionsProps["questions"];
}) {
  const state = resultState(result);
  const selectedReviews =
    state === "evaluated" ? (result.reviewNumbers ?? []) : [];
  return (
    <Box
      component="section"
      aria-label="選択した店舗の詳細"
      data-place-details
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        borderTop: "1px solid #cbd5e1",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Typography data-attribution variant="caption" color="primary">
          選択中の店舗 · Google Maps
        </Typography>
        <Button size="small" onClick={onClose}>
          一覧に戻る
        </Button>
      </Box>
      <Box
        data-detail-scroll
        sx={{
          px: 2,
          pb: 2,
          overflowY: "auto",
          overscrollBehavior: "contain",
          overflowWrap: "anywhere",
          minHeight: 0,
          flex: "1 1 120px",
        }}
      >
        <Typography variant="h6" sx={{ fontSize: 17, fontWeight: 700 }}>
          {result.name}
        </Typography>
        <Typography variant="body2" sx={{ my: 0.75 }}>
          {result.address}
        </Typography>
        <Typography variant="body2">
          Google 評価: {result.rating ?? "—"}/5
          {result.userRatingCount !== undefined &&
            `（${result.userRatingCount}件）`}
        </Typography>
        {result.openNow !== undefined && (
          <Typography variant="body2">
            {result.openNow ? "営業中" : "営業時間外"}
          </Typography>
        )}
        {result.weekdayDescriptions && (
          <Box component="ul" sx={{ m: 0, pl: 2, fontSize: 12 }}>
            {result.weekdayDescriptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </Box>
        )}
        {result.websiteUri && (
          <Link
            href={result.websiteUri}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
          >
            公式サイト
          </Link>
        )}
        <Typography variant="body2" sx={{ mt: 1 }}>
          条件「{result.evaluation}」:{" "}
          <Box
            component="strong"
            sx={{
              borderBottom:
                state !== "unknown" && result.value
                  ? `4px solid ${getRatingColor(result.value, true)}`
                  : undefined,
            }}
          >
            {state !== "unknown" && result.value
              ? `${result.value}/5`
              : stateLabels[state]}
          </Box>
        </Typography>
        {result.analysisError && result.analysis && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              評価エラー
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", my: 1 }}>
              {result.analysis}
            </Typography>
          </>
        )}
        {selectedReviews.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              関連する口コミ
            </Typography>
            <ReviewEvidence
              reviews={result.reviews}
              numbers={selectedReviews}
            />
          </Box>
        )}
        <Link
          href={result.googleMapsUri}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: "inline-block", mt: 1 }}
          variant="body2"
        >
          Google マップで開く
        </Link>
      </Box>
      <PlaceQuestions
        key={result.placeId}
        result={result}
        questions={questions}
      />
    </Box>
  );
}
