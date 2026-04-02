function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  return 1 - (levenshteinDistance(na, nb) / Math.max(na.length, nb.length));
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findBestMatch(target, candidates, threshold) {
  let best = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = similarity(target, candidate.text);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (bestScore >= (threshold || CONFIG.MATCH_THRESHOLD)) {
    return { match: best, score: bestScore };
  }
  return null;
}

function isAlreadyRestricted(title, existingTitles) {
  return existingTitles.some(
    (existing) => similarity(title, existing) >= CONFIG.MATCH_THRESHOLD
  );
}
