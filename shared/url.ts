export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
}

function stripBasePath(path: string, basePath: string): string {
  if (!basePath) return path;
  const normalized = path.replace(/^\/+/, "");
  const prefix = basePath.replace(/^\/+|\/+$/g, "");
  if (!prefix) return normalized;
  if (normalized === prefix) return "";
  if (normalized.startsWith(`${prefix}/`)) return normalized.slice(prefix.length + 1);
  return normalized;
}

/** Parses a git remote into a GitLab project path when its host matches the configured base URL. */
export function parseGitRemote(remoteUrl: string, baseUrl: string): string | null {
  const remote = remoteUrl.trim();
  if (!remote) return null;

  let base: URL;
  try {
    base = new URL(normalizeBaseUrl(baseUrl));
  } catch {
    return null;
  }
  const baseHost = base.hostname.toLowerCase();
  const basePath = base.pathname === "/" ? "" : base.pathname;

  let host: string;
  let path: string;

  const scp = /^[^/@\s]+@([^:/\s]+):(.+)$/.exec(remote);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(remote);
    } catch {
      return null;
    }
    host = parsed.hostname;
    path = parsed.pathname;
  }

  if (host.toLowerCase() !== baseHost) return null;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it contains a malformed escape.
  }

  const projectPath = stripGitSuffix(stripBasePath(decoded, basePath));
  if (!projectPath || !projectPath.includes("/")) return null;
  return projectPath;
}

/** Splits a GitLab reference such as "group/project!12" into its project path and IID. */
export function splitReference(reference: string): { projectPath: string; iid: number } | null {
  const match = /^(.*?)([#!])(\d+)$/.exec(reference.trim());
  if (!match) return null;
  const projectPath = match[1].replace(/\/+$/, "");
  const iid = Number.parseInt(match[3], 10);
  if (!projectPath || !Number.isFinite(iid)) return null;
  return { projectPath, iid };
}

/** Removes the base URL's path prefix from an absolute GitLab path. */
export function stripBaseUrlPath(path: string, baseUrl: string): string {
  try {
    const base = new URL(normalizeBaseUrl(baseUrl));
    return stripBasePath(path, base.pathname === "/" ? "" : base.pathname);
  } catch {
    return stripBasePath(path, "");
  }
}
