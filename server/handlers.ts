import { execFile } from "node:child_process";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  attachmentSearchRpc,
  connectionGetRpc,
  connectionTestRpc,
  issueGetRpc,
  issuesListRpc,
  mergeRequestGetRpc,
  mergeRequestsListRpc,
  projectDetectRpc,
} from "../shared/rpc";
import type { connectionSettings, credentialSettings } from "../shared/settings";
import { normalizeBaseUrl, parseGitRemote, splitReference, stripBaseUrlPath } from "../shared/url";
import {
  GitLabClient,
  type GitLabConfig,
  type GitLabNote,
  type GitLabRef,
  describeError,
  projectPathFromReference,
} from "./gitlab";

type ConnectionSettings = PluginSettings<(typeof connectionSettings)["schema"]>;
type CredentialSettings = PluginSettings<(typeof credentialSettings)["schema"]>;

interface Handlers {
  getConfig(): Promise<GitLabConfig>;
  connectionGet(input: RpcInput<typeof connectionGetRpc>): Promise<RpcOutput<typeof connectionGetRpc>>;
  connectionTest(input: RpcInput<typeof connectionTestRpc>): Promise<RpcOutput<typeof connectionTestRpc>>;
  projectDetect(input: RpcInput<typeof projectDetectRpc>): Promise<RpcOutput<typeof projectDetectRpc>>;
  mrsList(input: RpcInput<typeof mergeRequestsListRpc>): Promise<RpcOutput<typeof mergeRequestsListRpc>>;
  issuesList(input: RpcInput<typeof issuesListRpc>): Promise<RpcOutput<typeof issuesListRpc>>;
  mrGet(input: RpcInput<typeof mergeRequestGetRpc>): Promise<RpcOutput<typeof mergeRequestGetRpc>>;
  issueGet(input: RpcInput<typeof issueGetRpc>): Promise<RpcOutput<typeof issueGetRpc>>;
  attachmentSearch(input: RpcInput<typeof attachmentSearchRpc>): Promise<RpcOutput<typeof attachmentSearchRpc>>;
}

function runGit(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, "remote", "-v"],
      { encoding: "utf8", timeout: 10000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function itemProjectPath(projectPath: string, ref: GitLabRef, separator: "#" | "!"): string {
  return projectPathFromReference(projectPath, ref.references?.full, ref.iid, separator);
}

function baseItem(projectPath: string, ref: GitLabRef): {
  iid: number;
  projectPath: string;
  title: string;
  state: string;
  author: string;
  assignees: string[];
  labels: string[];
  updatedAt: string;
  webUrl: string;
  userNotesCount: number;
} {
  return {
    iid: ref.iid,
    projectPath,
    title: ref.title,
    state: ref.state,
    author: ref.author?.username ?? "unknown",
    assignees: (ref.assignees ?? []).map((user) => user.username ?? "").filter(Boolean),
    labels: ref.labels ?? [],
    updatedAt: ref.updated_at ?? "",
    webUrl: ref.web_url,
    userNotesCount: ref.user_notes_count ?? 0,
  };
}

function mapMergeRequest(projectPath: string, ref: GitLabRef) {
  return {
    ...baseItem(projectPath, ref),
    draft: ref.draft ?? ref.work_in_progress ?? /^draft:/i.test(ref.title),
    sourceBranch: ref.source_branch ?? "",
    targetBranch: ref.target_branch ?? "",
  };
}

function mapIssue(projectPath: string, ref: GitLabRef) {
  return baseItem(projectPath, ref);
}

function mapNotes(notes: GitLabNote[]) {
  return notes.map((note) => ({
    id: note.id,
    author: note.author?.username ?? "unknown",
    body: note.body,
    createdAt: note.created_at,
  }));
}

function truncate(value: string | null | undefined, max: number): string {
  const text = value ?? "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function directReference(query: string, baseUrl: string): {
  projectPath: string;
  iid: number;
  kind: "issue" | "merge_request";
} | null {
  let value = query.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = decodeURIComponent(parsed.pathname) + parsed.hash;
    } catch {
      return null;
    }
  }

  value = stripBaseUrlPath(value, baseUrl).replace(/^\/+|\/+$/g, "");

  const canonical = /^(.+?)\/-\/(issues|merge_requests)\/(\d+)$/.exec(value);
  if (canonical) {
    return {
      projectPath: canonical[1],
      iid: Number.parseInt(canonical[3], 10),
      kind: canonical[2] === "issues" ? "issue" : "merge_request",
    };
  }

  const reference = splitReference(value);
  if (!reference) return null;
  return {
    projectPath: reference.projectPath,
    iid: reference.iid,
    kind: value.includes("!") ? "merge_request" : "issue",
  };
}

function attachmentText(
  kind: "issue" | "merge_request",
  item: ReturnType<typeof mapMergeRequest> | ReturnType<typeof mapIssue>,
  description: string,
  extra?: { sourceBranch?: string; targetBranch?: string },
): string {
  const lines = [
    `${kind === "merge_request" ? "Merge request" : "Issue"} ${item.projectPath}${kind === "merge_request" ? "!" : "#"}${item.iid}: ${item.title}`,
    item.webUrl,
    `State: ${item.state}`,
    `Author: @${item.author}`,
  ];
  if (item.assignees.length > 0) lines.push(`Assignees: ${item.assignees.map((name) => `@${name}`).join(", ")}`);
  if (item.labels.length > 0) lines.push(`Labels: ${item.labels.join(", ")}`);
  if (extra?.sourceBranch && extra.targetBranch) {
    lines.push(`Branches: ${extra.sourceBranch} -> ${extra.targetBranch}`);
  }
  lines.push("", truncate(description, 20000));
  return lines.join("\n");
}

export function createHandlers(
  connection: ConnectionSettings,
  credentials: CredentialSettings,
): Handlers {
  async function readConnection(): Promise<{
    config: GitLabConfig;
    baseUrlRevision: string;
    tokenRevision: string;
  }> {
    const base = await connection.read();
    const credential = await credentials.read();
    if (base.status !== "ready") {
      throw new Error(`GitLab connection settings are invalid: ${base.error}`);
    }
    if (credential.status !== "ready") {
      throw new Error(`GitLab token settings are invalid: ${credential.error}`);
    }
    return {
      config: {
        baseUrl: normalizeBaseUrl(base.values.baseUrl),
        token: credential.values.token,
      },
      baseUrlRevision: base.revision,
      tokenRevision: credential.revision,
    };
  }

  async function getConfig(): Promise<GitLabConfig> {
    const { config } = await readConnection();
    return config;
  }

  function client(config: GitLabConfig): GitLabClient {
    return new GitLabClient(config);
  }

  return {
    getConfig,

    async connectionGet() {
      const { config, baseUrlRevision, tokenRevision } = await readConnection();
      let username: string | null = null;
      if (config.token) {
        try {
          username = (await client(config).getUser()).username;
        } catch {
          username = null;
        }
      }
      return {
        baseUrl: config.baseUrl,
        hasToken: config.token.length > 0,
        username,
        baseUrlRevision,
        tokenRevision,
      };
    },

    async connectionTest() {
      const config = await getConfig();
      const user = await client(config).getUser();
      return { username: user.username };
    },

    async projectDetect({ cwd }) {
      const config = await getConfig();
      let remotes: string[];
      try {
        const output = await runGit(cwd);
        remotes = output
          .split("\n")
          .map((line) => line.split("\t")[1]?.trim())
          .filter((url): url is string => Boolean(url));
      } catch (error) {
        return {
          projectPath: null,
          projectId: null,
          webUrl: null,
          defaultBranch: null,
          reason: `Cannot read git remotes in ${cwd}: ${describeError(error)}`,
        };
      }

      let projectPath: string | null = null;
      for (const remote of remotes) {
        projectPath = parseGitRemote(remote, config.baseUrl);
        if (projectPath) break;
      }
      if (!projectPath) {
        let host = config.baseUrl;
        try {
          host = new URL(config.baseUrl).host;
        } catch {
          // Use the raw base URL.
        }
        return {
          projectPath: null,
          projectId: null,
          webUrl: null,
          defaultBranch: null,
          reason:
            remotes.length === 0
              ? `No git remote URLs found in ${cwd}`
              : `No GitLab remote matching ${host} was found in ${cwd}`,
        };
      }

      try {
        const project = await client(config).getProject(projectPath);
        return {
          projectPath: project.path_with_namespace,
          projectId: project.id,
          webUrl: project.web_url,
          defaultBranch: project.default_branch ?? null,
          reason: null,
        };
      } catch (error) {
        return {
          projectPath: null,
          projectId: null,
          webUrl: null,
          defaultBranch: null,
          reason: describeError(error),
        };
      }
    },

    async mrsList(input) {
      const config = await getConfig();
      const page = await client(config).listMergeRequests(input);
      const projectPath = input.scope.kind === "project" ? input.scope.projectPath : "";
      return {
        items: page.items.map((item) => mapMergeRequest(itemProjectPath(projectPath, item, "!"), item)),
        nextPage: page.nextPage,
      };
    },

    async issuesList(input) {
      const config = await getConfig();
      const page = await client(config).listIssues(input);
      const projectPath = input.scope.kind === "project" ? input.scope.projectPath : "";
      return {
        items: page.items.map((item) => mapIssue(itemProjectPath(projectPath, item, "#"), item)),
        nextPage: page.nextPage,
      };
    },

    async mrGet({ projectPath, iid }) {
      const gitlab = client(await getConfig());
      const [detail, notes, approvals] = await Promise.all([
        gitlab.getMergeRequest(projectPath, iid),
        gitlab.getNotes(projectPath, "merge_requests", iid),
        gitlab.getApprovals(projectPath, iid),
      ]);
      return {
        ...mapMergeRequest(projectPath, detail),
        description: detail.description ?? "",
        reviewers: (detail.reviewers ?? []).map((user) => user.username ?? "").filter(Boolean),
        mergeStatus: detail.detailed_merge_status ?? detail.merge_status ?? null,
        headPipeline: detail.head_pipeline?.status ?? null,
        approvals,
        notes: mapNotes(notes),
      };
    },

    async issueGet({ projectPath, iid }) {
      const gitlab = client(await getConfig());
      const [detail, notes] = await Promise.all([
        gitlab.getIssue(projectPath, iid),
        gitlab.getNotes(projectPath, "issues", iid),
      ]);
      return {
        ...mapIssue(projectPath, detail),
        description: detail.description ?? "",
        notes: mapNotes(notes),
      };
    },

    async attachmentSearch({ query }) {
      const config = await getConfig();
      const gitlab = client(config);
      const direct = directReference(query, config.baseUrl);
      const items: RpcOutput<typeof attachmentSearchRpc>["items"] = [];

      if (direct) {
        if (direct.kind === "issue") {
          const detail = await gitlab.getIssue(direct.projectPath, direct.iid);
          const item = mapIssue(direct.projectPath, detail);
          items.push({
            id: `${direct.projectPath}#${direct.iid}`,
            identifier: `${direct.projectPath}#${direct.iid}`,
            title: item.title,
            subtitle: `Issue · ${item.state} · @${item.author}`,
            url: item.webUrl,
            text: attachmentText("issue", item, detail.description ?? ""),
            resourceType: "issue",
          });
        } else {
          const detail = await gitlab.getMergeRequest(direct.projectPath, direct.iid);
          const item = mapMergeRequest(direct.projectPath, detail);
          items.push({
            id: `${direct.projectPath}!${direct.iid}`,
            identifier: `${direct.projectPath}!${direct.iid}`,
            title: item.title,
            subtitle: `Merge request · ${item.state} · @${item.author}`,
            url: item.webUrl,
            text: attachmentText("merge_request", item, detail.description ?? "", {
              sourceBranch: item.sourceBranch,
              targetBranch: item.targetBranch,
            }),
            resourceType: "merge_request",
          });
        }
        return { items };
      }

      if (!gitlab.configured) throw new Error("GitLab is not configured");
      const search = query.trim();
      if (!search) return { items: [] };

      const [issues, mergeRequests] = await Promise.all([
        gitlab.search({ scope: "issues", query: search }),
        gitlab.search({ scope: "merge_requests", query: search }),
      ]);

      for (const detail of mergeRequests) {
        const projectPath = itemProjectPath("", detail, "!");
        const item = mapMergeRequest(projectPath, detail);
        items.push({
          id: `${projectPath}!${item.iid}`,
          identifier: `${projectPath}!${item.iid}`,
          title: item.title,
          subtitle: `Merge request · ${item.state} · @${item.author}`,
          url: item.webUrl,
          text: attachmentText("merge_request", item, detail.description ?? "", {
            sourceBranch: item.sourceBranch,
            targetBranch: item.targetBranch,
          }),
          resourceType: "merge_request",
        });
      }
      for (const detail of issues) {
        const projectPath = itemProjectPath("", detail, "#");
        const item = mapIssue(projectPath, detail);
        items.push({
          id: `${projectPath}#${item.iid}`,
          identifier: `${projectPath}#${item.iid}`,
          title: item.title,
          subtitle: `Issue · ${item.state} · @${item.author}`,
          url: item.webUrl,
          text: attachmentText("issue", item, detail.description ?? ""),
          resourceType: "issue",
        });
      }

      return { items };
    },
  };
}
