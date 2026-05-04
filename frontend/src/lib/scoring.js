// Scoring + growth math helpers (FERPA-safe — no answer key leakage).

export function scoreAttempt(responses, questions) {
  const byId = new Map(questions.map(q => [q.id, q]));
  let correct = 0;
  responses.forEach(r => {
    const q = byId.get(r.question_id);
    if (q && q.correct_answer === r.selected_answer) correct += 1;
  });
  const total = questions.length;
  const score_percent = total === 0 ? 0 : Math.round((correct / total) * 100);
  return { correct_count: correct, total_count: total, score_percent };
}

export function computeGrowth(bocScore, eocScore) {
  if (bocScore == null || eocScore == null) return { point_difference: null, growth_percentage: null };
  const point_difference = eocScore - bocScore;
  const available = 100 - bocScore;
  if (available <= 0) {
    return { point_difference, growth_percentage: 100 }; // already at ceiling
  }
  const growth_percentage = Math.round((point_difference / available) * 100);
  return { point_difference, growth_percentage };
}

export function shuffleSeeded(arr, seed = Date.now()) {
  // Fisher-Yates with mulberry32 seeded RNG for a stable randomized order
  const a = [...arr];
  let s = seed >>> 0;
  const rng = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
