// Normalize for matching only; the displayed excerpt remains untouched.
const normalize = (text: string) =>
  text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");

function longestCommonSubstring(left: string, right: string): number {
  const a = Array.from(left),
    b = Array.from(right);
  const lengths = new Uint32Array(b.length + 1);
  let longest = 0;
  for (const char of a) {
    for (let j = b.length; j > 0; j--) {
      lengths[j] = char === b[j - 1] ? lengths[j - 1] + 1 : 0;
      longest = Math.max(longest, lengths[j]);
    }
  }
  return longest;
}

export function matchReview<T extends { text: string }>(
  excerpt: string,
  reviews: readonly T[],
): T | undefined {
  const text = normalize(excerpt);
  if (!text) return undefined;
  const normalized = reviews.map((review) => ({
    review,
    text: normalize(review.text),
  }));
  const exact = normalized.filter((review) => review.text.includes(text));
  if (exact.length) return exact.length === 1 ? exact[0].review : undefined;
  const length = Array.from(text).length;
  const matches = normalized.filter((review) => {
    const common = longestCommonSubstring(text, review.text);
    // Avoid attributing a short generic fragment on the percentage rule alone.
    return common >= 20 || (common >= 8 && common / length >= 0.6);
  });
  return matches.length === 1 ? matches[0].review : undefined;
}
