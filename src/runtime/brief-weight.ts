// Weighs a brief by what it says, in code, so the same brief always gets the
// same roster and the reason can be shown to the owner. A heavy brief needs
// the specialists (the full roster): a whole product, a new screen to design,
// requirements to work out, an outside service, or a lot to do. A light one
// is a feature the Frontend Engineer and the Tester can carry (the slim
// roster, which won the benchmark on such briefs).

type Signal = { reason: string; weight: number; found: (brief: string) => boolean };

const wordCount = (brief: string) => brief.split(/\s+/).filter(Boolean).length;

// Sentences and list items: each is roughly one thing the owner asks for.
const requestCount = (brief: string) =>
  (brief.match(/[.!?](?=\s|$)/g) ?? []).length +
  (brief.match(/^\s*(?:[-*•]|\d+[.)])\s+/gm) ?? []).length;

const signals: Signal[] = [
  {
    reason: "a whole product to build",
    weight: 2,
    found: (brief) =>
      /\b(?:build|create|make)\s+(?:me\s+)?an?\s+(?:\w+\s+){0,2}(?:app|application|website|site|cms|platform|portal|store|shop|clone)\b|\bfrom scratch\b|\bCMS\b/i.test(
        brief,
      ),
  },
  {
    reason: "a new page or screen to design",
    weight: 1,
    found: (brief) =>
      /\b(?:new\s+(?:\w+\s+){0,3}(?:page|screen|view)s?|(?:add|build|create)\s+an?\s+(?:\w+\s+){0,3}(?:page|screen)\b|dashboard|redesign\w*|layout|wizard|onboarding|multi-step|design system|dark mode|responsive)\b/i.test(
        brief,
      ),
  },
  {
    reason: "requirements that need working out",
    weight: 1,
    found: (brief) =>
      /\b(?:better|improve\w*|nicer|cleaner|modern|polish\w*|intuitive|user[- ]friendly|feels?|confus\w*|unfinished|ugly|clunky)\b/i.test(
        brief,
      ),
  },
  {
    reason: "an outside service to integrate",
    weight: 1,
    // A path such as /login is a link in a page, not a sign-in to build.
    found: (brief) =>
      /\bAPI\b/.test(brief) ||
      /(?<![/\w])(?:REST|GraphQL|webhooks?|OAuth|third[- ]party|integrat\w*|sign[- ]?in|log[- ]?in|sign[- ]?up|authenticat\w*|payments?|Stripe|database)\b/i.test(
        brief,
      ),
  },
  {
    reason: "speed or size to improve",
    weight: 1,
    found: (brief) =>
      /\b(?:slow|performance|faster|speed up|optimi[sz]\w*|lighthouse|bundle size|lazy[- ]load\w*)\b/i.test(
        brief,
      ),
  },
  { reason: "a long brief", weight: 1, found: (brief) => wordCount(brief) > 150 },
  { reason: "many separate requests", weight: 1, found: (brief) => requestCount(brief) >= 6 },
];

const heavyAt = 2;

export type BriefWeight = { heavy: boolean; reasons: string[] };

export function weighBrief(brief: string): BriefWeight {
  const found = signals.filter((signal) => signal.found(brief));
  const score = found.reduce((total, signal) => total + signal.weight, 0);
  return { heavy: score >= heavyAt, reasons: found.map(({ reason }) => reason) };
}
