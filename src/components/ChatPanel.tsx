import { Box, Button, TextField, Typography } from "@mui/material";
import type { ChatStatus } from "ai";
import { useState } from "react";
import {
  isSearchPlacesFailure,
  type ChatToolPart,
  type ChatUIMessage,
} from "@/lib/chat-contract";

type Props = {
  messages: ChatUIMessage[];
  status: ChatStatus;
  // Error shown as an assistant-style line (HTTP error before streaming, or
  // an error chunk in the stream).
  error: string | null;
  // Sending is disabled while the map is missing, a search is running or the
  // month / session budget is exhausted.
  sendDisabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onInputFocus: () => void;
};

// Compact one-line summary of a `search_places` tool part.
export function describeToolPart(part: ChatToolPart): string {
  switch (part.state) {
    case "output-available": {
      if (isSearchPlacesFailure(part.output))
        return `検索に失敗しました: ${part.output.error.message}`;
      return `検索: ${part.output.textQuery} / 条件: ${part.output.evaluation} / 候補 ${part.output.places.length} 件`;
    }
    case "output-error":
      return `検索に失敗しました: ${part.errorText}`;
    case "output-denied":
      return "検索は実行されませんでした。";
    default:
      return part.input?.textQuery
        ? `検索中: ${part.input.textQuery}`
        : "検索の準備中...";
  }
}

export function ChatPanel(props: Props) {
  const [draft, setDraft] = useState("");
  const isStreaming =
    props.status === "submitted" || props.status === "streaming";
  const canSend = !props.sendDisabled && !isStreaming && draft.trim() !== "";

  const submit = () => {
    const text = draft.trim();
    if (!canSend || !text) return;
    setDraft("");
    props.onSend(text);
  };

  return (
    <Box
      data-chat-panel
      sx={{ display: "flex", flexDirection: "column", gap: 1 }}
    >
      <Box
        data-chat-log
        role="log"
        aria-live="polite"
        aria-busy={isStreaming}
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
          maxHeight: 220,
          overflowY: "auto",
          overscrollBehavior: "contain",
          fontSize: 13,
        }}
      >
        {props.messages.length === 0 && !props.error && (
          <Typography variant="body2" color="text.secondary">
            例:「渋谷で電源があるカフェ」「この辺で静かに作業できる喫茶店」
          </Typography>
        )}
        {props.messages.map((message) => (
          <Box
            key={message.id}
            data-chat-message
            data-chat-role={message.role}
            sx={{
              alignSelf: message.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              px: 1.25,
              py: 0.75,
              borderRadius: 2,
              bgcolor: message.role === "user" ? "#e3f2fd" : "#f3f5f7",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {message.parts.map((part, index) => {
              if (part.type === "text")
                return <span key={index}>{part.text}</span>;
              if (part.type === "tool-search_places")
                return (
                  <Typography
                    key={index}
                    data-chat-tool-result
                    data-chat-tool-state={part.state}
                    variant="caption"
                    sx={{ display: "block", color: "#475569", fontWeight: 600 }}
                  >
                    {describeToolPart(part)}
                  </Typography>
                );
              return null;
            })}
          </Box>
        ))}
        {props.error && (
          <Typography
            data-chat-error
            variant="body2"
            color="error"
            sx={{ overflowWrap: "anywhere" }}
          >
            {props.error}
          </Typography>
        )}
      </Box>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
        sx={{ display: "flex", gap: 1 }}
      >
        <TextField
          label="AI に相談"
          placeholder="例: 渋谷で電源があるカフェ"
          size="small"
          fullWidth
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={props.onInputFocus}
          disabled={props.sendDisabled}
          slotProps={{ htmlInput: { "data-chat-input": true } }}
        />
        {isStreaming ? (
          <Button
            type="button"
            data-chat-stop
            variant="outlined"
            disableElevation
            onClick={props.onStop}
            sx={{ flexShrink: 0 }}
          >
            停止
          </Button>
        ) : (
          <Button
            type="submit"
            data-chat-send
            variant="contained"
            disableElevation
            disabled={!canSend}
            sx={{ flexShrink: 0 }}
          >
            送信
          </Button>
        )}
      </Box>
    </Box>
  );
}
