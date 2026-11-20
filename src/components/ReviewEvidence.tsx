import { Avatar, Box, Link, Typography } from "@mui/material";
import type { SearchResult } from "@/lib/place-result";

export function ReviewEvidence({
  reviews,
  numbers,
}: {
  reviews: SearchResult["reviews"];
  numbers: number[];
}) {
  return numbers.map((number) => {
    const review = reviews[number - 1];
    if (!review) return null;
    return (
      <Box key={number} sx={{ my: 1 }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", my: 1 }}>
          {review.text}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.75 }}>
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
                  {" "}
                  ·{" "}
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
      </Box>
    );
  });
}
