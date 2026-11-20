"use client";

import { useState } from "react";
import Image from "next/image";
import {
  WALKING_ORIGIN_LABEL,
  WALKING_ROUTE_NOTICE,
  type MapConversationProps,
} from "@/lib/map-conversation";
import { resultState, stateLabels } from "@/lib/place-result";
import { scoreColor } from "@/lib/score-colors";
import { ReviewEvidence } from "./ReviewEvidence";
import { Histogram } from "./Histogram";
import styles from "./MapConversationPanel.module.css";

export function MapConversationPanel(props: MapConversationProps) {
  const [input, setInput] = useState("");
  const { candidates, selected, comparison, questions } = props;
  const busy = props.searching || !!questions.pendingQuestion;
  const scopeLabel =
    props.scope === "branch" && selected
      ? selected.name
      : props.scope === "candidates"
        ? "今の候補"
        : "表示中の地図";
  const send = () => {
    const text = input.trim();
    if (!text || props.disabled || busy) return;
    props.onSend(text);
    setInput("");
  };
  return (
    <section className={styles.panel} aria-label="チャットと検索結果">
      <div data-panel-body className={styles.body}>
        <header className={styles.header}>
          <img
            src="/service-mark.svg"
            alt="まちのコンパス"
            width={32}
            height={32}
          />
        </header>
        <div className={styles.scroll}>
          <div className={styles.conversation} aria-live="polite">
            {props.messages.slice(-6).map((message) => (
              <div
                key={message.id}
                className={`${styles.message} ${message.role === "user" ? styles.user : ""}`}
              >
                {message.role === "assistant" && (
                  <span className={styles.avatar} aria-hidden="true">
                    <img
                      src="/assistant-mark.svg"
                      alt=""
                      width={18}
                      height={18}
                    />
                  </span>
                )}
                <div className={styles.bubble}>{message.text}</div>
              </div>
            ))}
          </div>
          {props.error && (
            <p role="alert" className={styles.error}>
              {props.error}
            </p>
          )}
          {props.clarification && (
            <div className={styles.notice}>
              <p>「{props.clarification}」をどちらに使いますか？</p>
              <div className={styles.chips}>
                <button
                  type="button"
                  onClick={() => props.onRerank(props.clarification!)}
                >
                  今の候補を評価し直す
                </button>
                <button
                  type="button"
                  onClick={() => props.onAreaSearch(props.clarification!)}
                >
                  地図の範囲で探す
                </button>
              </div>
            </div>
          )}
          {!candidates.length && !props.searching && !props.messages.length && (
            <div className={styles.intro}>
              <p>たとえば、こんなふうに</p>
              <div className={styles.chips}>
                <button
                  type="button"
                  onClick={() => props.onSend("静かなカフェを探して")}
                  disabled={props.disabled}
                >
                  静かなカフェ ↗
                </button>
                <button
                  type="button"
                  onClick={() => props.onSend("電源があるカフェを探して")}
                  disabled={props.disabled}
                >
                  電源があるカフェ ↗
                </button>
              </div>
            </div>
          )}
          {(props.searching || props.evaluating) && (
            <p role="status" className={styles.status}>
              {props.searching
                ? "候補を探しています…"
                : `口コミを評価中 · ${props.evaluationAttempts}件試行`}
            </p>
          )}
          {selected && !comparison ? (
            <section className={styles.detail} data-place-details>
              <button
                type="button"
                className={styles.back}
                onClick={() => props.onScope("candidates")}
              >
                ← 候補一覧へ
              </button>
              <div className={styles.detailTitle}>
                <span className={styles.number}>{selected.pinNumber}</span>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.address}</p>
                </div>
              </div>
              <p className={styles.dataNote} data-attribution>
                Google Maps
              </p>
              <p className={styles.meta}>
                Google 評価 {selected.rating ?? "—"}/5
                {selected.userRatingCount !== undefined &&
                  `（${selected.userRatingCount}件）`}
                {selected.openNow !== undefined &&
                  ` · ${selected.openNow ? "営業中" : "営業時間外"}`}
              </p>
              <div className={styles.scoreBox}>
                <span>
                  {props.criterion
                    ? `「${props.criterion}」への適合度`
                    : "条件への適合度"}
                </span>
                <strong>
                  {resultState(selected) === "evaluated" ? (
                    <>
                      {selected.value}
                      <small> / 5</small>
                    </>
                  ) : (
                    stateLabels[resultState(selected)]
                  )}
                </strong>
              </div>
              {selected.analysis && (
                <p className={styles.analysis}>{selected.analysis}</p>
              )}
              {!!selected.reviewNumbers?.length && (
                <details className={styles.evidence}>
                  <summary>
                    評価の根拠となる口コミ {selected.reviewNumbers.length}件
                  </summary>
                  <ReviewEvidence
                    reviews={selected.reviews}
                    numbers={selected.reviewNumbers}
                  />
                </details>
              )}
              {selected.weekdayDescriptions && (
                <details className={styles.evidence}>
                  <summary>営業時間</summary>
                  {selected.weekdayDescriptions.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </details>
              )}
              <div className={styles.links}>
                {selected.websiteUri && (
                  <a
                    href={selected.websiteUri}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    公式サイト
                  </a>
                )}
                <a
                  href={selected.googleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google マップで開く
                </a>
              </div>
              <div className={styles.followups}>
                <p>このお店について聞く</p>
                <div className={styles.chips}>
                  {["電源はありますか？", "静かに過ごせますか？"].map(
                    (question) => (
                      <button
                        type="button"
                        key={question}
                        disabled={props.disabled || busy || questions.disabled}
                        onClick={() => props.onSend(question)}
                      >
                        {question} ↗
                      </button>
                    ),
                  )}
                </div>
              </div>
              {(questions.turns.length > 0 ||
                questions.pendingQuestion ||
                questions.error) && (
                <section className={styles.qa} aria-label="この店舗への質問">
                  <h3>この店舗への質問</h3>
                  {questions.turns.map((turn, index) => (
                    <div key={index} data-question-turn className={styles.turn}>
                      <strong>{turn.question}</strong>
                      <p>{turn.answer}</p>
                      {turn.reviewNumbers.length > 0 && (
                        <details className={styles.evidence}>
                          <summary>
                            根拠の口コミ {turn.reviewNumbers.length}件
                          </summary>
                          <ReviewEvidence
                            reviews={selected.reviews}
                            numbers={turn.reviewNumbers}
                          />
                        </details>
                      )}
                    </div>
                  ))}
                  {questions.pendingQuestion && (
                    <p>{questions.pendingQuestion} · 回答中…</p>
                  )}
                  {questions.error && (
                    <p role="alert" className={styles.error}>
                      {questions.error}
                    </p>
                  )}
                </section>
              )}
            </section>
          ) : (
            candidates.length > 0 && (
              <section className={styles.results}>
                <div className={styles.heading}>
                  <h2>
                    見つかったお店 <small>{candidates.length}件</small>
                  </h2>
                  {props.criterion && <span>{props.criterion}で評価</span>}
                </div>
                <Histogram results={candidates} />
                {comparison && (
                  <div className={styles.notice}>
                    <div className={styles.noticeHeading}>
                      <strong>徒歩時間を比較</strong>
                      <button
                        type="button"
                        onClick={props.onCancelComparison}
                        aria-label="比較を閉じる"
                      >
                        ×
                      </button>
                    </div>
                    <p>
                      {WALKING_ORIGIN_LABEL}から · 2店を選択{" "}
                      {comparison.placeIds.length}/2
                    </p>
                  </div>
                )}
                <div className={styles.list} aria-label="候補一覧">
                  {candidates.map((candidate) => {
                    const state = resultState(candidate);
                    const chosen =
                      comparison?.placeIds.includes(candidate.placeId) ?? false;
                    return (
                      <button
                        type="button"
                        key={candidate.placeId}
                        data-result-id={candidate.placeId}
                        data-fetch-state={state}
                        aria-pressed={
                          chosen || selected?.placeId === candidate.placeId
                        }
                        className={`${styles.card} ${chosen ? styles.chosen : ""}`}
                        onClick={() => props.onSelect(candidate.placeId)}
                      >
                        <span className={styles.number}>
                          {candidate.pinNumber}
                        </span>
                        <span className={styles.placeInfo}>
                          <strong>{candidate.name}</strong>
                          <span>
                            {stateLabels[state]} · Google ★{" "}
                            {candidate.rating ?? "—"}
                          </span>
                        </span>
                        <span
                          className={styles.score}
                          data-score={candidate.value ?? ""}
                          style={{
                            color: scoreColor(
                              state === "evaluated" ? candidate.value : null,
                            ),
                          }}
                        >
                          <b>{state === "evaluated" ? candidate.value : "—"}</b>
                          <small>適合度 / 5</small>
                        </span>
                        <span aria-hidden="true">
                          {comparison ? (chosen ? "✓" : "+") : "›"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {comparison ? (
                  <div>
                    {comparison.routes ? (
                      <div className={styles.comparisonResult}>
                        <strong>徒歩時間</strong>
                        <p>{WALKING_ROUTE_NOTICE}</p>
                        {comparison.routes.map((route) => (
                          <div key={route.placeId}>
                            <span>
                              {candidates.find(
                                (c) => c.placeId === route.placeId,
                              )?.name ?? route.placeId}
                            </span>
                            <b>
                              {route.durationSeconds === null
                                ? "取得できませんでした"
                                : `約 ${Math.ceil(route.durationSeconds / 60)} 分`}
                            </b>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        className={styles.primary}
                        type="button"
                        disabled={
                          comparison.placeIds.length !== 2 || comparison.pending
                        }
                        onClick={props.onCompare}
                      >
                        {comparison.pending
                          ? "比較中…"
                          : "選んだ2店を比較する →"}
                      </button>
                    )}
                    {comparison.error && (
                      <p role="alert" className={styles.error}>
                        {comparison.error}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className={styles.followups}>
                    <p>この候補について</p>
                    <div className={styles.chips}>
                      <button
                        type="button"
                        onClick={() =>
                          props.onRerank(
                            /電源/.test(props.criterion)
                              ? "静かに過ごせる"
                              : "電源が使いやすい",
                          )
                        }
                        disabled={props.disabled || busy}
                      >
                        {/電源/.test(props.criterion)
                          ? "静かさで評価し直す"
                          : "電源で評価し直す"}{" "}
                        ↗
                      </button>
                      <button
                        type="button"
                        onClick={props.onStartComparison}
                        disabled={candidates.length < 2 || props.disabled}
                      >
                        徒歩時間を比べる ↗
                      </button>
                    </div>
                  </div>
                )}
                <p className={styles.dataNote}>
                  適合度は口コミに基づく条件評価です · Google Maps
                </p>
              </section>
            )
          )}
        </div>
      </div>
      <form
        data-panel-header
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
      >
        <div className={styles.scope}>
          <span aria-hidden="true" className={styles.dot} />
          送信先 <strong>{scopeLabel}</strong>
          {props.scope !== "map" && (
            <button
              type="button"
              onClick={() =>
                props.onScope(
                  props.scope === "branch" && candidates.length
                    ? "candidates"
                    : "map",
                )
              }
              aria-label={
                props.scope === "branch"
                  ? "支店の選択を解除"
                  : "候補の選択を解除"
              }
            >
              ×
            </button>
          )}
          {candidates.length > 0 && props.scope !== "map" && (
            <button
              type="button"
              className={styles.scopeChange}
              onClick={() => props.onScope("map")}
            >
              地図に切替
            </button>
          )}
          {candidates.length > 0 && props.scope === "map" && (
            <button
              type="button"
              className={styles.scopeChange}
              onClick={() => props.onScope("candidates")}
            >
              候補に切替
            </button>
          )}
        </div>
        <div className={styles.inputRow}>
          <input
            aria-label="メッセージ"
            placeholder={
              props.scope === "branch"
                ? "このお店について質問する"
                : props.scope === "candidates"
                  ? "条件を変える、質問する..."
                  : "行きたい場所を聞いてみる..."
            }
            value={input}
            maxLength={props.scope === "branch" ? 300 : undefined}
            onChange={(event) => setInput(event.target.value)}
            onFocus={props.onInputFocus}
          />
          {busy ? (
            <button
              type="button"
              className={styles.stop}
              onClick={props.onStop}
            >
              中止
            </button>
          ) : (
            <button
              className={styles.send}
              type="submit"
              disabled={!input.trim() || props.disabled}
              aria-label="送信"
            >
              ↑
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
