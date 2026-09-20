import { matchReview } from "@/lib/review-match";
import { Avatar, Box, Button, Link, Typography } from "@mui/material";
import {
  getRatingColor,
  resultState,
  stateLabels,
  type SearchResult,
} from "@/lib/place-result";

export function PlaceDetails({
  result,
  onClose,
}: {
  result: SearchResult;
  onClose: () => void;
}) {
  const matchedReview =
    result.analysis && !result.analysisError
      ? matchReview(result.analysis, result.reviews ?? [])
      : undefined;
  const authors = matchedReview ? [matchedReview] : (result.reviews ?? []);
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
        <Typography variant="caption" color="primary">
          選択中の店舗
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
              borderBottom: result.value
                ? `4px solid ${getRatingColor(result.value, true)}`
                : undefined,
            }}
          >
            {result.value
              ? `${result.value}/5`
              : stateLabels[resultState(result)]}
          </Box>
        </Typography>
        {result.analysis && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              {result.analysisError ? "評価エラー" : "関連する口コミの抜粋"}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", my: 1 }}>
              {result.analysis}
            </Typography>
          </>
        )}
        {result.analysis && !result.analysisError && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {matchedReview
                ? "口コミの投稿者"
                : "参照した口コミの投稿者（抜粋との対応は特定できません）"}
            </Typography>
            {authors.map((review, index) => (
              <Box
                key={`${review.author.uri ?? review.author.name}-${index}`}
                sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.75 }}
              >
                <Avatar
                  src={review.author.photoUri}
                  alt={review.author.name || "投稿者"}
                  sx={{ width: 28, height: 28 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  {review.author.uri ? (
                    <Link
                      href={review.author.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="body2"
                    >
                      {review.author.name || "投稿者プロフィール"}
                    </Link>
                  ) : (
                    <Typography variant="body2">
                      {review.author.name || "投稿者情報なし"}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    {review.relativePublishTimeDescription}
                    {review.googleMapsUri && (
                      <>
                        {" · "}
                        <Link
                          href={review.googleMapsUri}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Google マップで口コミを見る
                        </Link>
                      </>
                    )}
                  </Typography>
                </Box>
              </Box>
            ))}
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
    </Box>
  );
}
