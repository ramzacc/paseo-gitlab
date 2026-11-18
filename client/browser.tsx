import type { PluginHostProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import {
  ExternalLink,
  Loading,
  Markdown,
  Modal,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  connectionGetRpc,
  issueGetRpc,
  issuesListRpc,
  mergeRequestGetRpc,
  mergeRequestsListRpc,
  projectDetectRpc,
  type IssueDetail,
  type IssueItem,
  type MergeRequestDetail,
  type MergeRequestItem,
} from "../shared/rpc";

type Tab = "merge_requests" | "issues";
type DetailTarget =
  | { kind: "merge_request"; iid: number; projectPath: string; title: string }
  | { kind: "issue"; iid: number; projectPath: string; title: string };

const MR_STATES = ["opened", "merged", "closed", "all"] as const;
const ISSUE_STATES = ["opened", "closed", "all"] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function RowButton(props: {
  label: string;
  active: boolean;
  theme: PluginHostProps["theme"];
  onPress(): void;
}) {
  const { label, active, theme, onPress } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: active ? theme.colors.accent : theme.colors.surface2,
      }}
    >
      <Text
        style={{
          color: active ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ItemRow(props: {
  theme: PluginHostProps["theme"];
  title: string;
  meta: string;
  labels: string[];
  onPress(): void;
}) {
  const { theme, title, meta, labels, onPress } = props;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingVertical: 10,
        gap: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>{title}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{meta}</Text>
      {labels.length > 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {labels.join(", ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function DetailScreen(props: {
  theme: PluginHostProps["theme"];
  compact: boolean;
  target: DetailTarget;
  cwd?: string;
  defaultBranch?: string | null;
  onBack(): void;
}) {
  const { theme, compact, target, cwd, defaultBranch, onBack } = props;
  const getMergeRequest = useRpc(mergeRequestGetRpc);
  const getIssue = useRpc(issueGetRpc);
  const detect = useRpc(projectDetectRpc);
  const paseo = usePaseo();
  const toast = useToast();
  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null as string | null);
  const [provider, setProvider] = useState("codex/gpt-5.5");

  const detail = useQuery<MergeRequestDetail | IssueDetail>({
    queryKey: ["gitlab", target.kind, target.projectPath, target.iid],
    queryFn: () =>
      target.kind === "merge_request"
        ? getMergeRequest({ projectPath: target.projectPath, iid: target.iid })
        : getIssue({ projectPath: target.projectPath, iid: target.iid }),
  });

  const checkout = useQuery({
    queryKey: ["gitlab", "checkout", target.projectPath, cwd ?? "auto"],
    queryFn: async () => {
      if (cwd) return cwd;
      const { entries } = await paseo.workspaces.list();
      for (const workspace of entries) {
        const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
        if (!directory) continue;
        try {
          const detected = await detect({ cwd: directory });
          if (detected.projectPath === target.projectPath) return directory;
        } catch {
          // Try the next workspace.
        }
      }
      return null;
    },
  });

  const providers = useQuery({
    queryKey: ["gitlab", "providers"],
    enabled: startOpen,
    queryFn: async () => {
      const snapshot = await paseo.providers.snapshot();
      const options: { label: string; value: string }[] = [];
      for (const entry of snapshot.entries) {
        if (entry.enabled === false) continue;
        const model =
          entry.models?.find((candidate) => candidate.isDefault) ?? entry.models?.[0];
        if (!model) continue;
        options.push({
          label: `${entry.label ?? entry.provider} · ${model.label ?? model.id}`,
          value: `${entry.provider}/${model.id}`,
        });
      }
      return options;
    },
  });

  useEffect(() => {
    if (providers.data && providers.data.length > 0) {
      const values = providers.data.map((option) => option.value);
      if (!values.includes(provider)) setProvider(values[0]);
    }
  }, [providers.data, provider]);

  const data = detail.data;
  const workCwd = checkout.data ?? null;

  async function startAgent() {
    if (!data) return;
    setStarting(true);
    setStartError(null);
    try {
      const directory = workCwd;
      if (!directory) {
        throw new Error(`No local checkout of ${target.projectPath} found`);
      }

      const isMergeRequest = target.kind === "merge_request";
      const prompt = isMergeRequest
        ? `Review GitLab MR !${data.iid}: ${data.title}\n${data.webUrl}\n\n${data.description ?? ""}`
        : `Work on GitLab issue #${data.iid}: ${data.title}\n${data.webUrl}\n\n${data.description ?? ""}`;

      const source = isMergeRequest
        ? {
            kind: "worktree" as const,
            cwd: directory,
            action: "checkout" as const,
            checkoutSource: {
              kind: "change_request" as const,
              forge: "gitlab",
              number: data.iid,
              projectPath: target.projectPath,
            },
          }
        : {
            kind: "worktree" as const,
            cwd: directory,
            action: "branch-off" as const,
            branchName: `issue-${data.iid}-${slug(data.title) || "work"}`,
            baseBranch: defaultBranch ?? undefined,
          };

      const workspace = await paseo.workspaces.create({
        title: isMergeRequest ? `Review MR !${data.iid}` : `Issue #${data.iid}`,
        source,
      });
      await workspace.agents.create({
        config: { provider },
        prompt,
      });
      setStartOpen(false);
      toast.show("Workspace created", { variant: "success" });
    } catch (error) {
      setStartError(messageOf(error));
      toast.error(messageOf(error));
    } finally {
      setStarting(false);
    }
  }

  const notes = data?.notes ?? [];
  const title = data?.title ?? target.title;

  return (
    <View style={{ gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={{ color: theme.colors.accent }}>Back</Text>
      </Pressable>

      <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>
        {title}
      </Text>

      {detail.isPending ? <Loading /> : null}
      {detail.error ? (
        <Text style={{ color: theme.colors.statusDanger }}>{messageOf(detail.error)}</Text>
      ) : null}

      {data ? (
        <>
          <View style={{ flexDirection: compact ? "column" : "row", gap: 12 }}>
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {target.projectPath}
              {target.kind === "merge_request" ? `!${data.iid}` : `#${data.iid}`}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted }}>{data.state}</Text>
            <Text style={{ color: theme.colors.foregroundMuted }}>@{data.author}</Text>
          </View>

          {target.kind === "merge_request" && "sourceBranch" in data ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {data.sourceBranch} → {data.targetBranch}
            </Text>
          ) : null}
          {target.kind === "merge_request" && "mergeStatus" in data ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              Merge status: {data.mergeStatus ?? "unknown"}
              {" · "}Pipeline: {data.headPipeline ?? "none"}
              {data.approvals ? ` · ${data.approvals}` : ""}
            </Text>
          ) : null}
          {data.assignees.length > 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              Assignees: {data.assignees.map((name) => `@${name}`).join(", ")}
            </Text>
          ) : null}
          {data.labels.length > 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              Labels: {data.labels.join(", ")}
            </Text>
          ) : null}
          {target.kind === "merge_request" && "reviewers" in data && data.reviewers.length > 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              Reviewers: {data.reviewers.map((name) => `@${name}`).join(", ")}
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <ExternalLink href={data.webUrl}>Open in GitLab</ExternalLink>
            <Pressable
              accessibilityRole="button"
              disabled={checkout.isPending || (!workCwd && checkout.isSuccess)}
              onPress={() => setStartOpen(true)}
              style={{
                opacity: checkout.isPending || (!workCwd && checkout.isSuccess) ? 0.5 : 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.accent,
              }}
            >
              <Text style={{ color: theme.colors.accentForeground }}>Start agent</Text>
            </Pressable>
          </View>

          {checkout.isPending ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>Looking for a local checkout...</Text>
          ) : null}
          {!workCwd && checkout.isSuccess ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              No local checkout of {target.projectPath} found
            </Text>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>
              Description
            </Text>
            <Markdown>{data.description || "_No description._"}</Markdown>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>
              Notes
            </Text>
            {notes.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted }}>No comments yet.</Text>
            ) : null}
            {notes.map((note) => (
              <View
                key={note.id}
                style={{
                  gap: 4,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  @{note.author} · {formatDate(note.createdAt)}
                </Text>
                <Markdown>{note.body}</Markdown>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Modal
        title="Start agent"
        open={startOpen}
        onOpenChange={setStartOpen}
      >
        <Modal.Content>
          <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>
            {target.kind === "merge_request"
              ? `Review MR !${target.iid} in a worktree`
              : `Work on issue #${target.iid} in a new branch`}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>{target.projectPath}</Text>
          {!workCwd ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              No local checkout of {target.projectPath} found
            </Text>
          ) : null}

          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>Provider</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(providers.data ?? [{ label: provider, value: provider }]).map((option) => (
              <RowButton
                key={option.value}
                label={option.label}
                active={option.value === provider}
                theme={theme}
                onPress={() => setProvider(option.value)}
              />
            ))}
          </View>
          {providers.isPending ? (
            <Text style={{ color: theme.colors.foregroundMuted }}>Loading providers...</Text>
          ) : null}
          {providers.error ? (
            <Text style={{ color: theme.colors.statusWarning }}>
              {messageOf(providers.error)}
            </Text>
          ) : null}
          {startError ? (
            <Text style={{ color: theme.colors.statusDanger }}>{startError}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={starting || !workCwd}
            onPress={() => void startAgent()}
            style={{
              padding: 12,
              borderRadius: 6,
              backgroundColor: theme.colors.accent,
              opacity: starting || !workCwd ? 0.5 : 1,
              alignItems: "center",
            }}
          >
            <Text style={{ color: theme.colors.accentForeground }}>
              {starting ? "Starting..." : "Create workspace"}
            </Text>
          </Pressable>
        </Modal.Content>
      </Modal>
    </View>
  );
}

export interface GitLabBrowserProps {
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
  mode: "project" | "mine";
  projectPath?: string;
  defaultBranch?: string | null;
  cwd?: string;
}

export function GitLabBrowser(props: GitLabBrowserProps) {
  const { theme, layout, mode, projectPath, defaultBranch, cwd } = props;
  const getConnection = useRpc(connectionGetRpc);
  const listMergeRequests = useRpc(mergeRequestsListRpc);
  const listIssues = useRpc(issuesListRpc);
  const [tab, setTab] = useState<Tab>("merge_requests");
  const [stateFilter, setStateFilter] = useState("opened");
  const [mineFilter, setMineFilter] = useState("assigned_to_me");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const compact = layout.compact;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (tab === "issues" && stateFilter === "merged") setStateFilter("opened");
    if (tab === "issues" && mineFilter === "review_requested") setMineFilter("assigned_to_me");
  }, [tab, stateFilter, mineFilter]);

  const connection = useQuery({
    queryKey: ["gitlab", "connection"],
    queryFn: () => getConnection({}),
  });

  const notConfigured = connection.data ? !connection.data.hasToken : false;
  const effectiveState =
    tab === "issues" && stateFilter === "merged" ? "opened" : stateFilter;
  const effectiveMine =
    tab === "issues" && mineFilter === "review_requested" ? "assigned_to_me" : mineFilter;

  const mergeRequests = useInfiniteQuery({
    queryKey: [
      "gitlab",
      "mrs",
      mode,
      projectPath ?? null,
      effectiveMine,
      effectiveState,
      search,
    ],
    enabled: tab === "merge_requests" && !(notConfigured && mode === "mine"),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listMergeRequests({
        scope:
          mode === "project" && projectPath
            ? { kind: "project", projectPath }
            : {
                kind: "mine",
                filter: effectiveMine as "assigned_to_me" | "created_by_me" | "review_requested",
              },
        state: effectiveState as "opened" | "merged" | "closed" | "all",
        search: search || undefined,
        page: pageParam,
      }),
    getNextPageParam: (last) => last.nextPage ?? undefined,
  });

  const issues = useInfiniteQuery({
    queryKey: [
      "gitlab",
      "issues",
      mode,
      projectPath ?? null,
      effectiveMine,
      effectiveState,
      search,
    ],
    enabled: tab === "issues" && !(notConfigured && mode === "mine"),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listIssues({
        scope:
          mode === "project" && projectPath
            ? { kind: "project", projectPath }
            : {
                kind: "mine",
                filter: effectiveMine as "assigned_to_me" | "created_by_me",
              },
        state: effectiveState as "opened" | "closed" | "all",
        search: search || undefined,
        page: pageParam,
      }),
    getNextPageParam: (last) => last.nextPage ?? undefined,
  });

  const active = tab === "merge_requests" ? mergeRequests : issues;
  const states = tab === "merge_requests" ? MR_STATES : ISSUE_STATES;
  const items: (MergeRequestItem | IssueItem)[] =
    tab === "merge_requests"
      ? mergeRequests.data?.pages.flatMap((page) => page.items) ?? []
      : issues.data?.pages.flatMap((page) => page.items) ?? [];

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: compact ? 12 : 20,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 18,
        fontWeight: "600" as const,
        marginBottom: 8,
      },
      muted: { color: theme.colors.foregroundMuted },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
    }),
    [theme, compact],
  );

  if (mode === "mine" && notConfigured) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>GitLab</Text>
        <Text style={{ color: theme.colors.statusWarning }}>
          GitLab is not configured. Add a base URL and personal access token in Settings,
          Plugins, GitLab.
        </Text>
      </View>
    );
  }

  if (detail) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 24 }}>
        <DetailScreen
          theme={theme}
          compact={compact}
          target={detail}
          cwd={cwd}
          defaultBranch={defaultBranch}
          onBack={() => setDetail(null)}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
      <Text style={styles.title}>{mode === "project" ? projectPath : "My GitLab"}</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <RowButton
          label="Merge requests"
          active={tab === "merge_requests"}
          theme={theme}
          onPress={() => setTab("merge_requests")}
        />
        <RowButton
          label="Issues"
          active={tab === "issues"}
          theme={theme}
          onPress={() => setTab("issues")}
        />
      </View>

      {mode === "mine" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <RowButton
            label="Assigned"
            active={mineFilter === "assigned_to_me"}
            theme={theme}
            onPress={() => setMineFilter("assigned_to_me")}
          />
          <RowButton
            label="Created"
            active={mineFilter === "created_by_me"}
            theme={theme}
            onPress={() => setMineFilter("created_by_me")}
          />
          {tab === "merge_requests" ? (
            <RowButton
              label="Review requested"
              active={mineFilter === "review_requested"}
              theme={theme}
              onPress={() => setMineFilter("review_requested")}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {states.map((state) => (
          <RowButton
            key={state}
            label={state}
            active={stateFilter === state}
            theme={theme}
            onPress={() => setStateFilter(state)}
          />
        ))}
      </View>

      <TextInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder="Search title or description"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
      />

      {connection.data && !connection.data.hasToken && mode === "project" ? (
        <Text style={styles.muted}>
          No token configured. Only public projects load until you add one in settings.
        </Text>
      ) : null}

      {active.isPending ? <Loading /> : null}
      {active.error ? (
        <Text style={{ color: theme.colors.statusDanger }}>{messageOf(active.error)}</Text>
      ) : null}
      {!active.isPending && !active.error && items.length === 0 ? (
        <Text style={styles.muted}>Nothing found.</Text>
      ) : null}

      <View>
        {items.map((item) => (
          <ItemRow
            key={`${item.projectPath}-${item.iid}`}
            theme={theme}
            title={
              "draft" in item && item.draft && !/^draft:/i.test(item.title)
                ? `Draft: ${item.title}`
                : item.title
            }
            meta={`${item.projectPath}${tab === "merge_requests" ? "!" : "#"}${item.iid} · ${item.state} · @${item.author} · ${formatDate(item.updatedAt)}`}
            labels={item.labels}
            onPress={() =>
              setDetail({
                kind: tab === "merge_requests" ? "merge_request" : "issue",
                iid: item.iid,
                projectPath: item.projectPath,
                title: item.title,
              })
            }
          />
        ))}
      </View>

      {active.hasNextPage ? (
        <Pressable
          accessibilityRole="button"
          disabled={active.isFetchingNextPage}
          onPress={() => void active.fetchNextPage()}
          style={{ paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ color: theme.colors.accent }}>
            {active.isFetchingNextPage ? "Loading..." : "Load more"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export function GitLabProjectPanelBody(props: {
  theme: PluginHostProps["theme"];
  layout: PluginHostProps["layout"];
  workspaceId: string;
}) {
  const { theme, layout, workspaceId } = props;
  const detect = useRpc(projectDetectRpc);
  const workspace = useWorkspace(workspaceId, (snapshot) => ({
    directory: snapshot.directory,
    root: snapshot.projectRootPath,
  }));
  const cwd = workspace?.directory ?? workspace?.root;

  const project = useQuery({
    queryKey: ["gitlab", "detect", cwd ?? null],
    enabled: Boolean(cwd),
    queryFn: () => detect({ cwd: cwd ?? "" }),
  });

  if (!workspace) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Workspace unavailable.</Text>
      </View>
    );
  }

  if (project.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        <Loading />
      </View>
    );
  }

  if (project.error) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{messageOf(project.error)}</Text>
      </View>
    );
  }

  if (!project.data.projectPath) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>
          GitLab
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>
          {project.data.reason ?? "No GitLab project detected for this workspace."}
        </Text>
      </View>
    );
  }

  return (
    <GitLabBrowser
      theme={theme}
      layout={layout}
      mode="project"
      projectPath={project.data.projectPath}
      defaultBranch={project.data.defaultBranch}
      cwd={cwd}
    />
  );
}
