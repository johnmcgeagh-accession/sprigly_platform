// Canonical BASE_QUESTIONS — the 5 monthly planning questions sent in the
// content-request email and shown in the manual intake UI.
// Shared between @sprigly/worker (request-email.ts) and @sprigly/web (IntakePanel).

export const BASE_QUESTIONS = [
  'Any key dates next month? Launches, events, deadlines.',
  "Anything new or returning to feature, or anything you'd rather we held back?",
  'Any specific looks, themes, or formats you want this month?',
  "Any stories worth telling? A behind-the-scenes moment, a customer story, something you're proud of.",
  'Anything specific you need driven this month?',
] as const;

export type BaseQuestion = typeof BASE_QUESTIONS[number];
