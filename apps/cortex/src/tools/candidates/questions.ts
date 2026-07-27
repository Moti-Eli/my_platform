/**
 * Candidates — the QUESTION BANK (Standard §2 support module).
 *
 * The questionnaire a candidate answers at invite time. It lives in TOOL CODE, not
 * the database, on purpose: `candidate_answers.question_text` is a DENORMALIZED
 * SNAPSHOT copied from here at materialization time (see 20260727000001's header),
 * so editing this bank later — rewording, reordering, adding a question — never
 * retroactively rewrites what a past candidate was actually asked.
 *
 * `key` is a STABLE snake_case id (the join key + the `unique(org_id, question_key)`
 * key that blocks double-materialization); it must never change once shipped.
 * `text` is the snapshot SOURCE — the exact wording frozen into each answer row.
 * `position` is the display order within the questionnaire.
 *
 * Placeholder Hebrew wording for now; the keys are the contract, the text is not.
 */
export interface CandidateQuestion {
  /** Stable snake_case identifier — the join key; never change once shipped. */
  key: string;
  /** Display order within the questionnaire (1-based). */
  position: number;
  /** The question as asked — snapshotted verbatim into `candidate_answers.question_text`. */
  text: string;
}

export const QUESTION_BANK: readonly CandidateQuestion[] = [
  {
    key: "experience",
    position: 1,
    text: "ספר/י על הניסיון התעסוקתי הרלוונטי שלך.",
  },
  {
    key: "availability",
    position: 2,
    text: "מהי הזמינות שלך להתחיל, ובאילו ימים ושעות?",
  },
  {
    key: "licenses_and_car",
    position: 3,
    text: "האם יש ברשותך רישיונות רלוונטיים ורכב זמין לעבודה?",
  },
  {
    key: "why_this_role",
    position: 4,
    text: "למה התפקיד הזה מתאים לך, ומה מושך אותך אליו?",
  },
] as const;
