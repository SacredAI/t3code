import { msg } from "gt-react";

/** Head branches that deploy, so the checklist never arms auto-merge on them. */
const PROTECTED_HEAD_BRANCHES = new Set(["develop", "demo", "rc", "master"]);

export const CHECKLIST_RISKS = ["Low", "Medium", "High", "Very High"] as const;
export type ChecklistRisk = (typeof CHECKLIST_RISKS)[number];

export const MERGE_CHOICES = [
  {
    label: msg("Merge", { $context: "verb, merge a pull request" }),
    detail: msg("Adds the merge label"),
    labels: ["merge"],
  },
  {
    label: msg("Queue", { $context: "verb, add a pull request to the merge queue" }),
    detail: msg("Adds the queue label"),
    labels: ["queue"],
  },
  {
    label: msg("Queue as urgent"),
    detail: msg("Adds the queue and urgent labels"),
    labels: ["queue", "urgent"],
  },
] as const;
export type MergeChoice = (typeof MERGE_CHOICES)[number];

const RISK_LINE = /^\s*-\s+\*\*Final assessed risk\*\*/;
const REVIEWER_HEADING = /^##\s+Reviewer(\s|$)/;
const UNCHECKED_ITEM = /^(\s*[-*]\s+)\[ \]/;

export function allowsAutoMerge(headBranch: string): boolean {
  return !PROTECTED_HEAD_BRANCHES.has(headBranch);
}

export function hasRiskField(body: string): boolean {
  return body.split(/\r?\n/).some((line) => RISK_LINE.test(line));
}

function mapLines(body: string, map: (line: string) => ReadonlyArray<string>): string {
  return body
    .split(/\r?\n/)
    .flatMap(map)
    .join(body.includes("\r\n") ? "\r\n" : "\n");
}

/**
 * Ticks the requester checklist above `## Reviewer`, replaces `fixes #xxxx` with the issue
 * numbers the head branch starts with (`123-456-name`), and sets the final assessed risk.
 */
export function completeRequesterChecklist(
  body: string,
  { headBranch, risk }: { headBranch: string; risk: ChecklistRisk | null },
): string {
  const issues = /^\d+(?:-\d+)*/.exec(headBranch)?.[0].split("-") ?? [];
  let inReviewer = false;
  return mapLines(body, (line) => {
    if (REVIEWER_HEADING.test(line)) inReviewer = true;
    if (inReviewer) return [line];
    if (issues.length > 0 && line.includes("fixes #xxxx")) {
      return issues.map((issue) => `fixes #${issue}`);
    }
    if (risk !== null && RISK_LINE.test(line)) return [`- **Final assessed risk**: ${risk}`];
    return [line.replace(UNCHECKED_ITEM, "$1[x]")];
  });
}

/** Ticks the checklist under `## Reviewer`, up to the next `##` heading. */
export function completeReviewerChecklist(body: string): string {
  let inReviewer = false;
  return mapLines(body, (line) => {
    if (/^##\s/.test(line)) inReviewer = REVIEWER_HEADING.test(line);
    return [inReviewer ? line.replace(UNCHECKED_ITEM, "$1[x]") : line];
  });
}
