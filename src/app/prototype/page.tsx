"use client";

import { useEffect, useRef, useState } from "react";
import "./prototype.css";

type Place = {
  id: number;
  name: string;
  area: string;
  description: string;
  x: number;
  y: number;
  quiet: number;
  power: number;
  walk: number;
  review: string;
  author: string;
};
const places: Place[] = [
  {
    id: 1,
    name: "喫茶 余白",
    area: "神南  ·  渋谷駅から徒歩6分",
    description: "路地裏で、ひと息つける喫茶店",
    x: 35,
    y: 35,
    quiet: 94,
    power: 58,
    walk: 6,
    review:
      "平日の午後に訪問。音楽も控えめで、窓際の席でゆっくり本が読めました。",
    author: "架空の投稿者 A",
  },
  {
    id: 2,
    name: "KITO COFFEE 渋谷店",
    area: "宇田川町  ·  渋谷駅から徒歩4分",
    description: "明るい窓辺のコーヒースタンド",
    x: 65,
    y: 48,
    quiet: 72,
    power: 95,
    walk: 4,
    review: "カウンター席にコンセントがあり、パソコン作業に便利でした。",
    author: "架空の投稿者 B",
  },
  {
    id: 3,
    name: "珈琲室 ひだまり",
    area: "桜丘町  ·  渋谷駅から徒歩8分",
    description: "木のぬくもりを感じる小さなカフェ",
    x: 48,
    y: 74,
    quiet: 86,
    power: 76,
    walk: 8,
    review: "落ち着いた雰囲気で、コーヒーを飲みながら過ごせました。",
    author: "架空の投稿者 C",
  },
];
type Message = { role: "user" | "assistant"; text: string };
const initial: Message[] = [
  { role: "assistant", text: "こんにちは。今日はどんな場所を探しますか？" },
];
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    spark: (
      <>
        <path d="M12 2 13.9 8.1 20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    arrow: (
      <>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    walk: (
      <>
        <circle cx="13" cy="4" r="2" />
        <path d="m7 21 3-6 2-3 2 3 3 2M8 10l3-3 3 1 2 3 3 1M10 15l4 6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export default function Prototype() {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [searched, setSearched] = useState(false);
  const [criterion, setCriterion] = useState<"quiet" | "power">("quiet");
  const [selected, setSelected] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [compared, setCompared] = useState(false);
  const [input, setInput] = useState("");
  const [sheet, setSheet] = useState<"compact" | "normal" | "expanded">(
    "normal",
  );
  const [focus, setFocus] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const selectedPlace = places.find((p) => p.id === selected);
  const ordered = [...places].sort((a, b) => b[criterion] - a[criterion]);
  const scope = selectedPlace
    ? selectedPlace.name
    : searched
      ? "いまの候補 3件"
      : "表示中の地図";
  const add = (text: string) =>
    setMessages((m) => [...m, { role: "user", text }]);
  const respond = (text: string) =>
    setMessages((m) => [...m, { role: "assistant", text }]);
  function send(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setInput("");
    add(text);
    setSheet("expanded");
    if (!searched) {
      setSearched(true);
      setCriterion(/電源|コンセント|作業/.test(text) ? "power" : "quiet");
      respond(
        "渋谷駅周辺で、カフェを3件見つけました。地図の番号からも選べます。",
      );
    } else if (selectedPlace) {
      respond(
        `${selectedPlace.name}について、架空の口コミを確認しました。「${selectedPlace.review}」という声があります。現在の混雑状況は、この情報だけではわかりません。`,
      );
    } else if (/徒歩|歩|比較|時間/.test(text)) {
      setComparing(true);
      setCompared(false);
      setChosen([]);
      respond(
        "徒歩時間を比べる2店を選んでください。出発地は渋谷駅（仮）です。",
      );
    } else if (/電源|コンセント|作業/.test(text)) {
      setCriterion("power");
      respond(
        "同じ3件を、電源の使いやすさで評価し直しました。番号はそのままです。",
      );
    } else if (/静か|静けさ|落ち着|ゆっくり/.test(text)) {
      setCriterion("quiet");
      respond(
        "同じ3件を、静かに過ごせそうかで評価し直しました。番号はそのままです。",
      );
    } else {
      respond(
        "この3件について、静かさや電源の条件を変えたり、徒歩時間を比べたりできます。",
      );
    }
  }
  function selectPlace(id: number) {
    if (comparing) {
      toggleChoice(id);
      return;
    }
    setSelected(id);
    setSheet("expanded");
  }
  function toggleChoice(id: number) {
    setChosen((c) =>
      c.includes(id)
        ? c.filter((x) => x !== id)
        : c.length < 2
          ? [...c, id]
          : c,
    );
    setCompared(false);
  }
  function closeDetail() {
    setSelected(null);
    setSheet("expanded");
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selected) closeDetail();
        else if (comparing) {
          setComparing(false);
          setCompared(false);
        } else setSheet("compact");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, comparing]);
  useEffect(() => {
    if (messages.length > 1)
      threadRef.current?.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [messages]);
  return (
    <main className={`proto ${focus ? "keyboard" : ""}`}>
      <section className="map" aria-label="渋谷駅周辺の模式地図">
        <svg
          className="map-art"
          viewBox="0 0 900 900"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <rect width="900" height="900" fill="#e9e9df" />
          <path
            d="M-50 140 950 560M-50 400 900 800M100 -50 650 950M370 -50 900 760M-50 700 820 -50"
            stroke="#d8ddd0"
            strokeWidth="65"
          />
          <path
            d="M-50 140 950 560M-50 400 900 800M100 -50 650 950M370 -50 900 760M-50 700 820 -50"
            stroke="#faf9f2"
            strokeWidth="40"
          />
          <path
            d="M-20 260 930 660M-20 560 930 140M200 -30 770 930M-20 810 820 20"
            stroke="#fbfaf4"
            strokeWidth="16"
          />
          <path d="M650 -50 310 950" stroke="#c9d4c1" strokeWidth="85" />
          <path d="M650 -50 310 950" stroke="#f6f4e8" strokeWidth="35" />
          <path
            d="M-40 730 920 320"
            stroke="#c9cbbf"
            strokeWidth="7"
            strokeDasharray="16 9"
          />
          <path
            d="M760 0c-90 100-30 160 20 220s60 145-5 220"
            stroke="#c8dcd5"
            strokeWidth="30"
            fill="none"
          />
          <g fill="#b6c9af">
            <path d="M62 40h160l42 81-114 57-104-40Z" />
            <path d="m745 590 100-40 65 72-46 120-110-20Z" />
            <path d="m80 627 92-32 45 69-39 95-98-17Z" />
          </g>
          <g
            fill="#9b9f91"
            fontSize="18"
            fontFamily="sans-serif"
            letterSpacing="3"
          >
            <text x="120" y="260">
              神南
            </text>
            <text x="630" y="290">
              宇田川町
            </text>
            <text x="570" y="730">
              桜丘町
            </text>
            <text x="175" y="575">
              道玄坂
            </text>
          </g>
        </svg>
        <div className="map-top">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="spark" size={19} />
            </span>
            <strong>まちのコンパス</strong>
          </div>
          <span className="demo-label">デモ</span>
        </div>
        <div className="map-area">
          <Icon name="pin" size={15} /> 渋谷駅周辺 <span>⌄</span>
        </div>
        <div className="map-center">
          <div className="station">
            <span>▰</span> 渋谷駅
          </div>
          {searched &&
            places.map((p) => (
              <button
                key={p.id}
                className={`map-pin ${selected === p.id ? "active" : ""} ${chosen.includes(p.id) && comparing ? "chosen" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onClick={() => selectPlace(p.id)}
                aria-label={`${p.name}、${criterion === "quiet" ? "静かさ" : "電源"} ${p[criterion]}点${comparing ? "、比較対象に選択" : "、詳細を開く"}`}
              >
                <span>{p.id}</span>
                <b>{p[criterion]}</b>
              </button>
            ))}
        </div>
        <div className="map-note">模式地図 · 架空の店舗</div>
      </section>
      <section className={`sheet ${sheet}`} aria-label="チャットと検索結果">
        <div className="sheet-handle">
          <span />
        </div>
        <header className="sheet-header">
          <div>
            <span className="eyebrow">YOUR LOCAL GUIDE</span>
            <h1>まちのコンパス</h1>
          </div>
          <div className="sheet-controls" aria-label="パネルの高さ">
            <button
              onClick={() =>
                setSheet(sheet === "compact" ? "normal" : "compact")
              }
              aria-label={
                sheet === "compact" ? "パネルを戻す" : "地図を広く見る"
              }
              title="地図を広く見る"
            >
              {sheet === "compact" ? "▢" : "—"}
            </button>
            <button
              onClick={() =>
                setSheet(sheet === "expanded" ? "normal" : "expanded")
              }
              aria-label={
                sheet === "expanded" ? "パネルを標準に戻す" : "パネルを広げる"
              }
              title="パネルを広げる"
            >
              {sheet === "expanded" ? "↙" : "↗"}
            </button>
          </div>
        </header>
        <div className="sheet-scroll" ref={threadRef}>
          <div className="conversation" aria-live="polite">
            {messages.map((m, i) => (
              <div className={`message ${m.role}`} key={i}>
                {m.role === "assistant" && (
                  <span className="avatar">
                    <Icon name="spark" size={16} />
                  </span>
                )}
                <div className="bubble">{m.text}</div>
              </div>
            ))}
          </div>
          {!searched && (
            <div className="intro">
              <p>たとえば、こんなふうに</p>
              <div className="chips">
                <button
                  onClick={() => send("渋谷駅周辺で静かなカフェを探して")}
                >
                  渋谷駅周辺で静かなカフェ <span>↗</span>
                </button>
                <button onClick={() => send("電源があるカフェを探して")}>
                  電源があるカフェ <span>↗</span>
                </button>
              </div>
            </div>
          )}
          {searched && !selectedPlace && (
            <div className="results">
              <div className="result-heading">
                <div>
                  <span className="eyebrow">PLACES NEARBY</span>
                  <h2>
                    見つかったお店 <small>3件</small>
                  </h2>
                </div>
                <span className="score-label">
                  {criterion === "quiet" ? "静かさ" : "電源"}で評価
                </span>
              </div>
              {comparing && (
                <div className="compare-prompt">
                  <div>
                    <strong>徒歩時間を比較</strong>
                    <p>
                      渋谷駅（仮）から · 2店を選択 <b>{chosen.length}/2</b>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setComparing(false);
                      setCompared(false);
                    }}
                    aria-label="比較を閉じる"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              )}
              <div className="place-list">
                {ordered.map((p, index) => (
                  <button
                    className={`place-card ${chosen.includes(p.id) && comparing ? "is-chosen" : ""}`}
                    key={p.id}
                    onClick={() => selectPlace(p.id)}
                  >
                    <span className="place-number">
                      {comparing ? (chosen.includes(p.id) ? "✓" : "+") : p.id}
                    </span>
                    <span className="place-info">
                      <strong>{p.name}</strong>
                      <span>{p.area}</span>
                    </span>
                    <span className="place-score">
                      <b>{p[criterion]}</b>
                      <small>適合度</small>
                    </span>
                    <Icon name="chevron" size={17} />
                    {index === 0 && <span className="top-tag">おすすめ</span>}
                  </button>
                ))}
              </div>
              {comparing ? (
                <div className="compare-action">
                  {compared ? (
                    <div className="comparison-result">
                      <strong>
                        <Icon name="walk" size={18} /> 渋谷駅からの徒歩時間{" "}
                        <small>（目安・架空）</small>
                      </strong>
                      {chosen.map((id) => {
                        const p = places.find((x) => x.id === id)!;
                        return (
                          <div key={id}>
                            <span>{p.name}</span>
                            <b>約 {p.walk} 分</b>
                          </div>
                        );
                      })}
                      <button onClick={() => setCompared(false)}>
                        選び直す
                      </button>
                    </div>
                  ) : (
                    <button
                      className="primary-action"
                      disabled={chosen.length !== 2}
                      onClick={() => {
                        setCompared(true);
                        respond(
                          "選んだ2店の徒歩時間を比べました。時間はデモ用の目安です。",
                        );
                      }}
                    >
                      選んだ2店を比較する <span>→</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="followups">
                  <p>この候補について</p>
                  <div className="chips">
                    <button
                      onClick={() =>
                        send(
                          criterion === "quiet"
                            ? "電源が使いやすい順にして"
                            : "静かに過ごせる順にして",
                        )
                      }
                    >
                      {criterion === "quiet"
                        ? "電源で評価し直す"
                        : "静かさで評価し直す"}{" "}
                      <span>↗</span>
                    </button>
                    <button onClick={() => send("2店の徒歩時間を比べたい")}>
                      徒歩時間を比べる <span>↗</span>
                    </button>
                  </div>
                </div>
              )}
              <p className="data-note">
                適合度は架空の口コミに基づくデモ評価です
              </p>
            </div>
          )}
          {selectedPlace && (
            <div className="detail">
              <div className="detail-top">
                <button className="back-link" onClick={closeDetail}>
                  ← 候補一覧へ
                </button>
                <button
                  className="close"
                  onClick={closeDetail}
                  aria-label="詳細を閉じて候補一覧に戻る"
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="detail-title">
                <span className="place-number">{selectedPlace.id}</span>
                <div>
                  <span className="eyebrow">SELECTED PLACE</span>
                  <h2>{selectedPlace.name}</h2>
                  <p>{selectedPlace.area}</p>
                </div>
              </div>
              <p className="detail-description">{selectedPlace.description}</p>
              <div className="detail-score">
                <span>
                  {criterion === "quiet" ? "静かさ" : "電源"}への適合度
                </span>
                <strong>
                  {selectedPlace[criterion]}
                  <small> / 100</small>
                </strong>
              </div>
              <div className="evidence">
                <h3>口コミからわかること</h3>
                <p>
                  {selectedPlace.id === 2
                    ? "カウンター席の電源が作業に便利だったという声があります。"
                    : "落ち着いて過ごせたという声があります。"}{" "}
                  利用する時間帯によって状況は変わることがあります。
                </p>
                <details>
                  <summary>
                    口コミの原文を見る <span>＋</span>
                  </summary>
                  <blockquote>
                    「{selectedPlace.review}」
                    <footer>
                      {selectedPlace.author} · デモ用の架空の口コミ
                    </footer>
                  </blockquote>
                </details>
                <div className="unknown">
                  <strong>まだわからないこと</strong>
                  <p>現在の混雑状況や電源の空きは確認できていません。</p>
                </div>
              </div>
              <div className="followups">
                <p>このお店について聞く</p>
                <div className="chips">
                  <button onClick={() => send("口コミではどんな雰囲気？")}>
                    口コミではどんな雰囲気？ <span>↗</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="scope">
            <span className="scope-dot" /> 送信先 <strong>{scope}</strong>
            {selectedPlace && (
              <button
                type="button"
                onClick={closeDetail}
                aria-label="支店の選択を解除"
              >
                ×
              </button>
            )}
          </div>
          <div className="input-row">
            <input
              aria-label="メッセージ"
              placeholder={
                selectedPlace
                  ? "このお店について質問する"
                  : searched
                    ? "条件を変える、質問する..."
                    : "行きたい場所を聞いてみる..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => {
                setFocus(true);
                setSheet("expanded");
              }}
              onBlur={() => setFocus(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.nativeEvent.isComposing)
                  e.preventDefault();
              }}
            />
            <button
              className="send"
              type="submit"
              disabled={!input.trim()}
              aria-label="送信"
            >
              <Icon name="arrow" size={20} />
            </button>
          </div>
          <p>架空の情報を使ったプロトタイプです</p>
        </form>
      </section>
    </main>
  );
}
