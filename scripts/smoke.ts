import { GitLabClient } from "../server/gitlab";
import { parseGitRemote } from "../shared/url";

const BASE = "https://gitlab.com";
const PROJECT = "gitlab-org/gitlab-runner";
let failures = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectMessage(action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), `expected "${expected}", got "${message}"`);
    return;
  }
  throw new Error(`expected failure with "${expected}"`);
}

async function main() {
  console.log("Remote parser");

  await check("git@host:group/sub/proj.git", () => {
    assertEqual(parseGitRemote("git@gitlab.com:group/sub/proj.git", BASE), "group/sub/proj", "scp");
  });
  await check("ssh://git@host:2222/group/proj.git", () => {
    assertEqual(
      parseGitRemote("ssh://git@gitlab.com:2222/group/proj.git", BASE),
      "group/proj",
      "ssh URL",
    );
  });
  await check("https://host/group/proj.git", () => {
    assertEqual(parseGitRemote("https://gitlab.com/group/proj.git", BASE), "group/proj", "https");
  });
  await check("https://user@host/group/proj", () => {
    assertEqual(parseGitRemote("https://user@gitlab.com/group/proj", BASE), "group/proj", "user URL");
  });
  await check("base URL path prefix", () => {
    assertEqual(
      parseGitRemote("https://gitlab.com/gitlab/group/proj", "https://gitlab.com/gitlab"),
      "group/proj",
      "path prefix",
    );
  });
  await check("non-matching host returns null", () => {
    assertEqual(parseGitRemote("https://example.com/group/proj.git", BASE), null, "other host");
  });

  const anonymous = new GitLabClient({ baseUrl: BASE, token: "" });
  let mergeRequestIid = 0;
  let issueIid = 0;

  console.log("Public reads without a token");
  await check(`list opened MRs for ${PROJECT}`, async () => {
    const page = await anonymous.listMergeRequests({
      scope: { kind: "project", projectPath: PROJECT },
      state: "opened",
      page: 1,
    });
    assert(page.items.length >= 1, "expected at least one merge request");
    const item = page.items[0];
    mergeRequestIid = item.iid;
    assert(item.iid > 0, "missing iid");
    assert(Boolean(item.title), "missing title");
    assert(Boolean(item.author?.username), "missing author");
    assert(Boolean(item.web_url), "missing web URL");
    assert(Boolean(item.updated_at), "missing updated_at");
    assert(Boolean(item.references?.full), "missing references.full");
    assert(Array.isArray(item.labels), "missing labels");
  });

  await check(`list opened issues for ${PROJECT}`, async () => {
    const page = await anonymous.listIssues({
      scope: { kind: "project", projectPath: PROJECT },
      state: "opened",
      page: 1,
    });
    assert(page.items.length >= 1, "expected at least one issue");
    const item = page.items[0];
    issueIid = item.iid;
    assert(item.iid > 0, "missing iid");
    assert(Boolean(item.title), "missing title");
    assert(Boolean(item.author?.username), "missing author");
    assert(Boolean(item.web_url), "missing web URL");
    assert(Boolean(item.updated_at), "missing updated_at");
    assert(Boolean(item.references?.full), "missing references.full");
  });

  await check("fetch one MR detail and notes", async () => {
    const detail = await anonymous.getMergeRequest(PROJECT, mergeRequestIid);
    const notes = await anonymous.getNotes(PROJECT, "merge_requests", mergeRequestIid);
    assert(Boolean(detail.title), "missing title");
    assert(typeof detail.description === "string", "missing description");
    assert(Array.isArray(notes), "notes should be an array");
  });

  await check("fetch one issue detail and notes", async () => {
    const detail = await anonymous.getIssue(PROJECT, issueIid);
    const notes = await anonymous.getNotes(PROJECT, "issues", issueIid);
    assert(Boolean(detail.title), "missing title");
    assert(typeof detail.description === "string", "missing description");
    assert(Array.isArray(notes), "notes should be an array");
  });

  await check("nonexistent project maps to 404 message", async () => {
    await expectMessage(
      () =>
        anonymous.listIssues({
          scope: { kind: "project", projectPath: "definitely-not-a-real-project-xyz/foo" },
          state: "opened",
          page: 1,
        }),
      "Project not found or no access",
    );
  });

  await check("bogus token maps to 401 message", async () => {
    const bogus = new GitLabClient({ baseUrl: BASE, token: "bogus-token-value" });
    await expectMessage(() => bogus.getUser(), "Invalid or expired token");
  });

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll checks passed");
  }
}

void main();
