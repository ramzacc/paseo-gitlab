import { splitReference, normalizeBaseUrl } from "../shared/url";

export interface GitLabConfig {
  baseUrl: string;
  token: string;
}

export interface GitLabRef {
  iid: number;
  title: string;
  state: string;
  description?: string | null;
  web_url: string;
  updated_at?: string | null;
  author?: { username?: string } | null;
  assignees?: { username?: string }[] | null;
  reviewers?: { username?: string }[] | null;
  labels?: string[] | null;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch?: string;
  target_branch?: string;
  user_notes_count?: number;
  references?: { full?: string; short?: string } | null;
  merge_status?: string | null;
  detailed_merge_status?: string | null;
  head_pipeline?: { status?: string | null } | null;
  project_id?: number;
}

export interface GitLabNote {
  id: number;
  body: string;
  system?: boolean;
  created_at: string;
  author?: { username?: string } | null;
}

export interface GitLabProject {
  id: number;
  path_with_namespace: string;
  web_url: string;
  default_branch?: string | null;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  requireToken?: boolean;
}

export interface Page<T> {
  items: T[];
  nextPage: number | null;
}

function isErrorWithMessage(error: unknown): error is { message: string } {
  return typeof error === "object" && error !== null && "message" in error;
}

function errorText(error: unknown): string {
  return isErrorWithMessage(error) ? error.message : String(error);
}

export class GitLabClient {
  readonly baseUrl: string;
  readonly token: string;
  private readonly host: string;

  constructor(config: GitLabConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.token = config.token.trim();
    try {
      this.host = new URL(this.baseUrl).host;
    } catch {
      this.host = this.baseUrl;
    }
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<{ body: T; headers: Headers }> {
    if (options.requireToken && !this.configured) {
      throw new Error("GitLab is not configured");
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.configured) headers["PRIVATE-TOKEN"] = this.token;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/v4${path}${suffix}`, { headers });
    } catch (error) {
      throw new Error(`Cannot reach ${this.host}: ${errorText(error)}`);
    }

    if (response.status === 401) {
      throw new Error("Invalid or expired token");
    }
    if (response.status === 404) {
      throw new Error("Project not found or no access");
    }
    if (!response.ok) {
      let message = "";
      try {
        const parsed = (await response.json()) as { message?: unknown };
        message = typeof parsed.message === "string" ? parsed.message : "";
      } catch {
        message = "";
      }
      throw new Error(
        message
          ? `GitLab request failed (${response.status}): ${message}`
          : `GitLab request failed (${response.status})`,
      );
    }

    const body = (await response.json()) as T;
    return { body, headers: response.headers };
  }

  private async requestPage<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Page<T>> {
    const { body, headers } = await this.request<T[]>(path, options);
    const next = Number.parseInt(headers.get("x-next-page") ?? "", 10);
    return { items: body, nextPage: Number.isFinite(next) && next > 0 ? next : null };
  }

  async getUser(): Promise<{ username: string }> {
    return this.request<{ username: string }>("/user", { requireToken: true }).then(
      ({ body }) => body,
    );
  }

  async getProject(projectPath: string): Promise<GitLabProject> {
    const { body } = await this.request<GitLabProject>(
      `/projects/${encodeURIComponent(projectPath)}`,
    );
    return body;
  }

  async listMergeRequests(input: {
    scope:
      | { kind: "project"; projectPath: string }
      | { kind: "mine"; filter: "assigned_to_me" | "created_by_me" | "review_requested" };
    state: string;
    search?: string;
    page: number;
  }): Promise<Page<GitLabRef>> {
    const query: Record<string, string | number | undefined> = {
      state: input.state,
      page: input.page,
      per_page: 20,
      order_by: "updated_at",
      sort: "desc",
      search: input.search,
    };

    if (input.scope.kind === "project") {
      return this.requestPage<GitLabRef>(
        `/projects/${encodeURIComponent(input.scope.projectPath)}/merge_requests`,
        { query },
      );
    }

    if (!this.configured) throw new Error("GitLab is not configured");
    if (input.scope.filter === "review_requested") {
      const user = await this.getUser();
      return this.requestPage<GitLabRef>("/merge_requests", {
        query: { ...query, reviewer_username: user.username },
      });
    }
    return this.requestPage<GitLabRef>("/merge_requests", {
      query: { ...query, scope: input.scope.filter },
    });
  }

  async listIssues(input: {
    scope:
      | { kind: "project"; projectPath: string }
      | { kind: "mine"; filter: "assigned_to_me" | "created_by_me" };
    state: string;
    search?: string;
    page: number;
  }): Promise<Page<GitLabRef>> {
    const query: Record<string, string | number | undefined> = {
      state: input.state,
      page: input.page,
      per_page: 20,
      order_by: "updated_at",
      sort: "desc",
      search: input.search,
    };

    if (input.scope.kind === "project") {
      return this.requestPage<GitLabRef>(
        `/projects/${encodeURIComponent(input.scope.projectPath)}/issues`,
        { query },
      );
    }

    if (!this.configured) throw new Error("GitLab is not configured");
    return this.requestPage<GitLabRef>("/issues", {
      query: { ...query, scope: input.scope.filter },
    });
  }

  async getMergeRequest(projectPath: string, iid: number): Promise<GitLabRef> {
    const { body } = await this.request<GitLabRef>(
      `/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}`,
    );
    return body;
  }

  async getIssue(projectPath: string, iid: number): Promise<GitLabRef> {
    const { body } = await this.request<GitLabRef>(
      `/projects/${encodeURIComponent(projectPath)}/issues/${iid}`,
    );
    return body;
  }

  async getNotes(projectPath: string, kind: "merge_requests" | "issues", iid: number): Promise<GitLabNote[]> {
    try {
      const { body } = await this.request<GitLabNote[]>(
        `/projects/${encodeURIComponent(projectPath)}/${kind}/${iid}/notes`,
        { query: { sort: "asc", order_by: "created_at", per_page: 50 } },
      );
      return body.filter((note) => !note.system);
    } catch (error) {
      // GitLab rejects notes for anonymous reads. Keep the public detail usable without a token.
      if (errorText(error) === "Invalid or expired token") return [];
      throw error;
    }
  }

  async getApprovals(projectPath: string, iid: number): Promise<string | null> {
    try {
      const { body } = await this.request<{
        approved_by?: unknown[];
        approvals_required?: number;
      }>(`/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}/approvals`);
      const approved = Array.isArray(body.approved_by) ? body.approved_by.length : 0;
      const required =
        typeof body.approvals_required === "number" ? body.approvals_required : null;
      return required === null
        ? `${approved} approval${approved === 1 ? "" : "s"}`
        : `${approved} of ${required} approvals`;
    } catch {
      return null;
    }
  }

  async search(input: {
    scope: "issues" | "merge_requests";
    query: string;
    projectPath?: string;
  }): Promise<GitLabRef[]> {
    if (!this.configured) throw new Error("GitLab is not configured");
    const path = input.projectPath
      ? `/projects/${encodeURIComponent(input.projectPath)}/search`
      : "/search";
    const { body } = await this.request<GitLabRef[]>(path, {
      query: { scope: input.scope, search: input.query, per_page: 10 },
      requireToken: true,
    });
    return body;
  }
}

export function projectPathFromReference(projectPath: string, reference: string | undefined, iid: number, separator: "#" | "!"): string {
  if (reference) {
    const parsed = splitReference(reference);
    if (parsed) return parsed.projectPath;
    if (reference.endsWith(`${separator}${iid}`)) {
      return reference.slice(0, -(String(iid).length + 1));
    }
  }
  return projectPath;
}

export function describeError(error: unknown): string {
  return errorText(error);
}
