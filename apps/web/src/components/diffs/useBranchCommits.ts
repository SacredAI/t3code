import { RegistryContext } from "@effect/atom-react";
import {
  REVIEW_BRANCH_COMMITS_MAX_LIMIT,
  REVIEW_BRANCH_COMMITS_PAGE_SIZE,
  type EnvironmentId,
  type ReviewBranchCommitsResult,
} from "@t3tools/contracts";
import { useContext, useState } from "react";
import { type MessageResolver, m } from "~/i18n/messages";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { waitForQuerySettled } from "~/state/waitForQuerySettled";

// Looking for a selected commit loads at most this many unasked; more takes a click.
const FIND_COMMIT_MAX_LIMIT = 1_000;

export interface BranchCommitsTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly baseRef: string | null;
}

function branchCommitsQuery(target: BranchCommitsTarget, limit: number) {
  return reviewEnvironment.branchCommits({
    environmentId: target.environmentId,
    input: {
      cwd: target.cwd,
      ...(target.baseRef ? { baseRef: target.baseRef } : {}),
      limit,
    },
  });
}

/**
 * The branch's newest commits. Each load doubles the list, and the list grows by itself until it
 * holds `include`, so a selected commit always has neighbours.
 */
export function useBranchCommits(
  target: BranchCommitsTarget | null,
  include: string | null,
  resolve: MessageResolver = m,
) {
  const registry = useContext(RegistryContext);
  const listKey = target
    ? JSON.stringify([target.environmentId, target.cwd, target.baseRef])
    : null;
  const [requested, setRequested] = useState({ listKey, limit: REVIEW_BRANCH_COMMITS_PAGE_SIZE });
  const limit = requested.listKey === listKey ? requested.limit : REVIEW_BRANCH_COMMITS_PAGE_SIZE;
  const query = useEnvironmentQuery(target ? branchCommitsQuery(target, limit) : null, resolve);
  const [menuOpen, setMenuOpen] = useState(false);
  // Shows the last list while a larger one loads. An open menu keeps the list it opened with, so
  // rows do not move under the pointer, but still takes the older commits it asked for.
  const [held, setHeld] = useState<{
    listKey: string;
    limit: number;
    result: ReviewBranchCommitsResult;
  } | null>(null);
  const latest = query.data;
  if (
    listKey !== null &&
    latest !== null &&
    (held?.listKey !== listKey || held.limit !== limit || (!menuOpen && held.result !== latest))
  ) {
    setHeld({ listKey, limit, result: latest });
  }
  const shown = held?.listKey === listKey ? held : null;
  const pendingLimit = shown !== null && shown.limit !== limit ? limit : null;
  // A server without paging returns one page whatever the limit asks for.
  const serverCannotPage =
    shown !== null && shown.result.truncated && shown.result.commits.length < shown.limit;
  const canLoadMore =
    shown !== null &&
    shown.result.truncated &&
    !serverCannotPage &&
    shown.limit < REVIEW_BRANCH_COMMITS_MAX_LIMIT;
  const nextLimit = (from: number) => Math.min(from * 2, REVIEW_BRANCH_COMMITS_MAX_LIMIT);

  if (
    listKey !== null &&
    shown !== null &&
    include !== null &&
    canLoadMore &&
    pendingLimit === null &&
    shown.limit < FIND_COMMIT_MAX_LIMIT &&
    !shown.result.commits.some((commit) => commit.sha === include)
  ) {
    setRequested({ listKey, limit: nextLimit(shown.limit) });
  }

  /** Resolves with the longer list, or undefined when there is none. */
  const loadMore = (): Promise<ReviewBranchCommitsResult | undefined> => {
    if (!target || listKey === null || shown === null) return Promise.resolve(undefined);
    const next = pendingLimit ?? (canLoadMore ? nextLimit(shown.limit) : null);
    if (next === null) return Promise.resolve(undefined);
    if (next !== limit) setRequested({ listKey, limit: next });
    return waitForQuerySettled({
      registry,
      atom: branchCommitsQuery(target, next),
      settle: (value) => value ?? undefined,
      signal: new AbortController().signal,
    });
  };

  return {
    commits: shown?.result ?? null,
    error: query.error,
    canLoadMore,
    serverCannotPage,
    isLoadingMore: pendingLimit !== null && query.isPending,
    loadMore,
    onMenuOpenChange: (open: boolean) => {
      setMenuOpen(open);
      // The menu keeps the list it opened with; the refreshed one shows next time.
      if (open) query.refresh();
    },
  };
}
