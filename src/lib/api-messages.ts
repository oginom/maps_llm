// User-facing error messages shared by the route handlers and the chat
// stream. Kept free of Next.js imports so `node --test` can load them.
export const INTERNAL_ERROR_MESSAGE =
  "サーバー内部でエラーが発生しました。時間をおいて再試行してください。";
export const OPENAI_QUOTA_MESSAGE =
  "OpenAI の利用上限に達しました。時間をおいて再試行してください。";
export const CLIENT_ABORTED_MESSAGE = "リクエストが中断されました。";
