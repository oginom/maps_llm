import { resultState, type SearchResult } from "@/lib/place-result";
import { SCORE_COLORS, UNSCORED_COLOR } from "@/lib/score-colors";
import styles from "./MapConversationPanel.module.css";

export function Histogram({ results }: { results: SearchResult[] }) {
  const bins = [0, 0, 0, 0, 0];
  let unscored = 0;
  results.forEach((result) => {
    const { value } = result;
    if (resultState(result) === "evaluated" && value != null && Number.isFinite(value) && value >= 1 && value <= 5)
      bins[Math.min(4, Math.floor(value) - 1)]++;
    else unscored++;
  });
  const maximum = Math.max(1, ...bins, unscored);
  return (
    <section
      className={styles.distribution}
      aria-label="適合度の分布"
      data-histogram
    >
      <div className={styles.distributionHeading}>
        適合度の分布 <span>低 → 高</span>
      </div>
      <div className={styles.bins}>
        {bins.map((count, index) => (
          <div
            key={index}
            className={styles.bin}
            data-bin={index + 1}
            data-count={count}
            aria-label={`適合度 ${index + 1}、${count}件`}
          >
            <span
              className={styles.binBar}
              style={{
                backgroundColor: SCORE_COLORS[index],
                height: `${(20 * count) / maximum}px`,
              }}
            />
            <span>
              {index + 1}点 <b>{count}件</b>
            </span>
          </div>
        ))}
        <div
          className={styles.bin}
          data-bin="unscored"
          data-count={unscored}
          aria-label={`未採点、${unscored}件`}
        >
          <span
            className={styles.binBar}
            style={{
              backgroundColor: UNSCORED_COLOR,
              height: `${(20 * unscored) / maximum}px`,
            }}
          />
          <span>
            未採点 <b>{unscored}件</b>
          </span>
        </div>
      </div>
    </section>
  );
}
