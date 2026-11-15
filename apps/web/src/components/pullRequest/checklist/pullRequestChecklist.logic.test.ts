import { describe, expect, it } from "vite-plus/test";

import {
  completeRequesterChecklist,
  completeReviewerChecklist,
} from "./pullRequestChecklist.logic";

const TEMPLATE = [
  "**Issues Fixed**",
  "fixes #xxxx",
  "",
  "- **Final assessed risk**: <!-- Low / Medium / High / Very High -->",
  "",
  "## Requester",
  "",
  "- [ ] Working - Proven to work.",
  "- [na] Performance - Not relevant.",
  "",
  "> - If a checkbox is **not relevant**, replace `[ ]` with `[na]` (don’t check it).",
  "",
  "## Reviewer",
  "",
  "- [ ] Proven - Author has proven this to work.",
  "",
  "<details>",
  "",
  "## Actions Troubleshooting",
  "- [ ] Not a reviewer item.",
].join("\r\n");

describe("pull request checklists", () => {
  it("fills the requester side and leaves the reviewer side and reminders alone", () => {
    const body = completeRequesterChecklist(TEMPLATE, {
      headBranch: "20760-20761-embedded-identity",
      risk: "Medium",
    });

    expect(body.split("\r\n")).toEqual([
      "**Issues Fixed**",
      "fixes #20760",
      "fixes #20761",
      "",
      "- **Final assessed risk**: Medium",
      "",
      "## Requester",
      "",
      "- [x] Working - Proven to work.",
      "- [na] Performance - Not relevant.",
      "",
      "> - If a checkbox is **not relevant**, replace `[ ]` with `[na]` (don’t check it).",
      "",
      "## Reviewer",
      "",
      "- [ ] Proven - Author has proven this to work.",
      "",
      "<details>",
      "",
      "## Actions Troubleshooting",
      "- [ ] Not a reviewer item.",
    ]);
  });

  it("ticks only the reviewer section", () => {
    const body = completeReviewerChecklist(TEMPLATE).split("\r\n");

    expect(body).toContain("- [x] Proven - Author has proven this to work.");
    expect(body).toContain("- [ ] Working - Proven to work.");
    expect(body).toContain("- [ ] Not a reviewer item.");
  });
});
