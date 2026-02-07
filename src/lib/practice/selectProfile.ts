import { practiceProfiles, PracticeProfile } from "@/data/practice/profiles";

const tokenize = (input: string) =>
  input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export const selectProfile = (input: string): PracticeProfile => {
  const tokens = new Set(tokenize(input));
  if (!tokens.size) return practiceProfiles[0];

  let best = practiceProfiles[0];
  let bestScore = 0;

  for (const profile of practiceProfiles) {
    let score = 0;
    for (const keyword of profile.signals.keywords ?? []) {
      const keywordTokens = tokenize(keyword);
      const allMatch = keywordTokens.every((token) => tokens.has(token));
      const anyMatch = keywordTokens.some((token) => tokens.has(token));
      if (allMatch) score += 3;
      else if (anyMatch) score += 1;
    }
    for (const role of profile.signals.roles ?? []) {
      const roleTokens = tokenize(role);
      const allMatch = roleTokens.every((token) => tokens.has(token));
      const anyMatch = roleTokens.some((token) => tokens.has(token));
      if (allMatch) score += 2;
      else if (anyMatch) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  }

  return best;
};