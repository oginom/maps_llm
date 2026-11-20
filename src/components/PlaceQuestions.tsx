import { Alert, Box, Button, Chip, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { SearchResult } from "@/lib/place-result";
import { ReviewEvidence } from "./ReviewEvidence";

export type PlaceQuestionsProps = {
  result: SearchResult;
  questions: {
    turns: { question: string; answer: string; reviewNumbers: number[] }[];
    pendingQuestion: string | null;
    error: string | null;
    disabled: boolean;
    ask: (question: string) => void;
  };
};

const suggestions = [
  "電源はありますか？",
  "静かに過ごせますか？",
  "混雑していますか？",
];

export function PlaceQuestions({ result, questions }: PlaceQuestionsProps) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<number[]>([]);
  const busy = questions.disabled || questions.pendingQuestion !== null;
  function send(text: string) {
    const question = text.trim();
    if (busy || !question || question.length > 300) return;
    setDraft("");
    questions.ask(question);
  }
  return (
    <Box
      data-place-questions
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: "1 1 240px",
        borderTop: "1px solid #cbd5e1",
      }}
    >
      <Box
        role="log"
        aria-live="polite"
        aria-busy={!!questions.pendingQuestion}
        sx={{
          overflowY: "auto",
          overscrollBehavior: "contain",
          minHeight: 0,
          flex: 1,
          px: 2,
          py: 1,
          overflowWrap: "anywhere",
        }}
      >
        {questions.turns.map((turn, index) => {
          const numbers = [...new Set(turn.reviewNumbers)]
            .filter(
              (n) => Number.isInteger(n) && n > 0 && n <= result.reviews.length,
            )
            .slice(0, 3);
          return (
            <Box key={index} data-question-turn sx={{ mb: 1.5 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, whiteSpace: "pre-wrap" }}
              >
                {turn.question}
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}
              >
                {turn.answer}
              </Typography>
              {numbers.length > 0 && (
                <>
                  <Button
                    size="small"
                    aria-expanded={expanded.includes(index)}
                    onClick={() =>
                      setExpanded((old) =>
                        old.includes(index)
                          ? old.filter((n) => n !== index)
                          : [...old, index],
                      )
                    }
                  >
                    根拠の口コミ {numbers.length}件{" "}
                    {expanded.includes(index) ? "▲" : "▼"}
                  </Button>
                  {expanded.includes(index) && (
                    <ReviewEvidence
                      reviews={result.reviews}
                      numbers={numbers}
                    />
                  )}
                </>
              )}
            </Box>
          );
        })}
        {questions.pendingQuestion && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {questions.pendingQuestion}
            </Typography>
            <Typography variant="body2">回答中...</Typography>
          </Box>
        )}
        {questions.error && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {questions.error}
          </Alert>
        )}
      </Box>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
        sx={{ flexShrink: 0, px: 1.5, pb: 1, pt: 0.5 }}
      >
        <Box
          sx={{ display: "flex", gap: 0.5, overflowX: "auto", pb: 0.75 }}
          aria-label="質問の候補"
        >
          {suggestions.map((suggestion) => (
            <Chip
              key={suggestion}
              label={suggestion}
              size="small"
              clickable
              disabled={busy}
              onClick={() => send(suggestion)}
            />
          ))}
        </Box>
        <Typography
          variant="caption"
          sx={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}
        >
          質問先: {result.name}
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField
            label="この店舗に質問"
            size="small"
            fullWidth
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={busy || !draft.trim()}
            sx={{ flexShrink: 0 }}
          >
            送信
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {draft.length}/300
        </Typography>
      </Box>
    </Box>
  );
}
