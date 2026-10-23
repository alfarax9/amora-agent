// Tells a question from a request for work, so a question is answered at once
// (the Assistant) instead of going through a plan, an approval, and a copy of
// the project. Asking for work politely ("can you add …") is still work; when
// in doubt, a brief is work, since the Planner can handle anything.

const asking =
  /^(what|why|how|who|when|where|which|whose|is|are|was|were|does|do|did|should|explain|apa|apakah|kenapa|mengapa|bagaimana|gimana|siapa|kapan|dimana|di mana|berapa|jelaskan)\b/i;

const working =
  /^(please\s+|tolong\s+|coba\s+)?(add|build|create|make|fix|implement|write|change|update|remove|delete|refactor|rename|move|set up|tambah|tambahkan|buat|buatkan|bikin|perbaiki|ubah|ganti|hapus|implementasikan)\b/i;

const requesting = /^(can|could|would|will)\s+you\b|^(bisakah|bisa|tolong)\b/i;

export function isQuestion(brief: string): boolean {
  const text = brief.trim();
  if (working.test(text) || requesting.test(text)) return false;
  return text.endsWith("?") || asking.test(text);
}
