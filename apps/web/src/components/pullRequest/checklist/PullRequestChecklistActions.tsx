import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PullRequestDetailView, PullRequestRef } from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";

import { namedClipboardTarget, writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { toastManager } from "../../ui/toast";
import { latestPullRequestReviewOutcomes, readableFailure } from "../pullRequestDetail.logic";
import { PullRequestGlyph } from "../pullRequestIcons";
import {
  MERGE_CHOICES,
  CHECKLIST_RISKS,
  type MergeChoice,
  type ChecklistRisk,
  allowsAutoMerge,
  completeRequesterChecklist,
  completeReviewerChecklist,
  hasRiskField,
} from "./pullRequestChecklist.logic";

interface Step {
  readonly label: string;
  readonly run: () => Promise<AtomCommandResult<unknown, unknown>>;
}

type Flow = "checklist" | "approve";

/** The `pr-checklist` and `merge-pr` workflows as header buttons. */
export function PullRequestChecklistActions({
  environmentId,
  reference,
  detail,
  onActed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  onActed: () => void;
}) {
  const canWrite = useAtomValue(pullRequestEnvironment.runAction.permissionAtom(environmentId));
  const update = useAtomCommand(pullRequestEnvironment.update, { reportFailure: false });
  const setLabels = useAtomCommand(pullRequestEnvironment.setLabels, { reportFailure: false });
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });
  const [running, setRunning] = useState<Flow | null>(null);
  const gt = useGT();
  const messages = useMessages();
  const flowName = { checklist: gt("PR checklist"), approve: gt("Approve & merge") };

  if (detail.state !== "open") return null;
  const isAuthor = detail.viewer === undefined || detail.author?.login === detail.viewer;
  // GitHub refuses approvals from the author.
  const canApprove = detail.viewerPermissions.verdicts.includes("approve");
  const disabled = !canWrite || running !== null;

  const editBody = (body: string): Step[] =>
    body === detail.body
      ? []
      : [
          {
            label: gt("Update the description"),
            run: () => update({ environmentId, input: { ...reference, body } }),
          },
        ];
  const addLabels = (names: ReadonlyArray<string>): Step[] => {
    const missing = names.filter((name) => !detail.labels.some((label) => label.name === name));
    return missing.length === 0
      ? []
      : [
          {
            label: gt(
              "{count, plural, =1 {Add the {labels} label} other {Add the {labels} labels}}",
              { count: missing.length, labels: missing.join(", ") },
            ),
            run: () =>
              setLabels({ environmentId, input: { ...reference, labels: missing, applied: true } }),
          },
        ];
  };
  const enableRebaseAutoMerge: Step[] =
    detail.autoMergeEnabled === true
      ? []
      : [
          {
            label: gt("Enable rebase auto-merge"),
            run: () =>
              runAction({
                environmentId,
                input: { ...reference, action: "enable-auto-merge", mergeMethod: "rebase" },
              }),
          },
        ];

  const runSteps = async (flow: Flow, steps: ReadonlyArray<Step>): Promise<boolean> => {
    setRunning(flow);
    for (const step of steps) {
      const result = await step.run();
      if (result._tag === "Failure") {
        setRunning(null);
        onActed();
        toastManager.add({
          type: "error",
          title: gt("{flow} stopped at: {step}", { flow: flowName[flow], step: step.label }),
          description: readableFailure(
            squashAtomCommandFailure(result),
            gt("The host refused it. The steps before it are done. Run it again to finish."),
          ),
        });
        return false;
      }
    }
    setRunning(null);
    onActed();
    return true;
  };

  const runChecklist = async (risk: ChecklistRisk | null) => {
    // Copy before the first await: browsers allow clipboard writes only close to the click.
    const link = `rfr - ${detail.url}`;
    const copied = await writeTextToClipboard(link, namedClipboardTarget("review link")).catch(
      () => false,
    );
    const done = await runSteps("checklist", [
      ...editBody(completeRequesterChecklist(detail.body, { headBranch: detail.headBranch, risk })),
      ...addLabels(["merge", "skip-strict"]),
      ...(detail.isDraft
        ? [
            {
              label: gt("Mark ready for review"),
              run: () => runAction({ environmentId, input: { ...reference, action: "ready" } }),
            },
          ]
        : []),
      ...(allowsAutoMerge(detail.headBranch) ? enableRebaseAutoMerge : []),
    ]);
    if (done) {
      toastManager.add({
        type: "success",
        title: gt("PR checklist done"),
        description: copied
          ? gt('Copied "{link}"', { link })
          : gt("Could not copy the review link."),
      });
    }
  };

  const approveAndMerge = async (choice: MergeChoice) => {
    const approved =
      detail.viewer !== undefined &&
      latestPullRequestReviewOutcomes(detail.comments, detail.commits).some(
        (entry) =>
          entry.actor?.login === detail.viewer && entry.outcome === "approved" && !entry.stale,
      );
    const done = await runSteps("approve", [
      ...editBody(completeReviewerChecklist(detail.body)),
      ...(approved
        ? []
        : [
            {
              label: gt("Approve", { $context: "verb, approve a pull request" }),
              run: () =>
                submitReview({
                  environmentId,
                  input: { ...reference, verdict: "approve", body: "LGTM.", comments: [] },
                }),
            },
          ]),
      ...enableRebaseAutoMerge,
      ...addLabels(choice.labels),
    ]);
    if (done) {
      toastManager.add({
        type: "success",
        title: gt("Approved: {choice}", { choice: messages(choice.label) }),
      });
    }
  };

  const checklistLabel = running === "checklist" ? gt("Running checklist...") : flowName.checklist;
  const approveLabel = running === "approve" ? gt("Approving...") : flowName.approve;
  const checklistContent = (
    <>
      <ListChecksIcon aria-hidden className="size-3.5" />
      <span className="@max-[35rem]/pr-header:hidden">{checklistLabel}</span>
    </>
  );

  return (
    <>
      {isAuthor && hasRiskField(detail.body) ? (
        <Menu>
          <MenuTrigger
            disabled={disabled}
            render={
              <Button size="xs" variant="outline" aria-label={checklistLabel}>
                {checklistContent}
                <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <MenuPopup align="end" side="bottom">
            <MenuGroup>
              <MenuGroupLabel>
                <T>Final assessed risk</T>
              </MenuGroupLabel>
              {CHECKLIST_RISKS.map((risk) => (
                <MenuItem key={risk} onClick={() => void runChecklist(risk)}>
                  {risk}
                </MenuItem>
              ))}
              <MenuItem onClick={() => void runChecklist(null)}>
                <T>Keep as is</T>
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      ) : isAuthor ? (
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          aria-label={checklistLabel}
          onClick={() => void runChecklist(null)}
        >
          {checklistContent}
        </Button>
      ) : null}
      {canApprove ? (
        <Menu>
          <MenuTrigger
            disabled={disabled}
            render={
              <Button size="xs" variant="outline" aria-label={approveLabel}>
                <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                <span className="@max-[35rem]/pr-header:hidden">{approveLabel}</span>
                <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <MenuPopup align="end" side="bottom">
            {MERGE_CHOICES.map((choice) => (
              <MenuItem key={choice.label} onClick={() => void approveAndMerge(choice)}>
                <span className="flex min-w-0 flex-col">
                  <span>{messages(choice.label)}</span>
                  <span className="text-xs text-muted-foreground">{messages(choice.detail)}</span>
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
}
