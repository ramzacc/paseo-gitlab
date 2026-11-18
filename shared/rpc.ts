import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const mergeRequestItemSchema = z.object({
  iid: z.number().int(),
  projectPath: z.string(),
  title: z.string(),
  state: z.string(),
  author: z.string(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  updatedAt: z.string(),
  webUrl: z.string(),
  draft: z.boolean(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  userNotesCount: z.number(),
});

export const issueItemSchema = z.object({
  iid: z.number().int(),
  projectPath: z.string(),
  title: z.string(),
  state: z.string(),
  author: z.string(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  updatedAt: z.string(),
  webUrl: z.string(),
  userNotesCount: z.number(),
});

export const noteSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

const mineMergeRequestFilter = z.enum([
  "assigned_to_me",
  "created_by_me",
  "review_requested",
]);
const mineIssueFilter = z.enum(["assigned_to_me", "created_by_me"]);

const mergeRequestScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectPath: z.string() }),
  z.object({ kind: z.literal("mine"), filter: mineMergeRequestFilter }),
]);

const issueScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectPath: z.string() }),
  z.object({ kind: z.literal("mine"), filter: mineIssueFilter }),
]);

export const connectionGetRpc = defineRpc({
  name: "connection.get",
  input: z.object({}),
  output: z.object({
    baseUrl: z.string(),
    hasToken: z.boolean(),
    username: z.string().nullable(),
    baseUrlRevision: z.string(),
    tokenRevision: z.string(),
  }),
});

export const connectionTestRpc = defineRpc({
  name: "connection.test",
  input: z.object({}),
  output: z.object({ username: z.string() }),
});

export const projectDetectRpc = defineRpc({
  name: "project.detect",
  input: z.object({ cwd: z.string() }),
  output: z.object({
    projectPath: z.string().nullable(),
    projectId: z.number().nullable(),
    webUrl: z.string().nullable(),
    defaultBranch: z.string().nullable(),
    reason: z.string().nullable(),
  }),
});

export const mergeRequestsListRpc = defineRpc({
  name: "mrs.list",
  input: z.object({
    scope: mergeRequestScope,
    state: z.enum(["opened", "merged", "closed", "all"]).default("opened"),
    search: z.string().optional(),
    page: z.number().int().min(1).default(1),
  }),
  output: z.object({
    items: z.array(mergeRequestItemSchema),
    nextPage: z.number().int().nullable(),
  }),
});

export const issuesListRpc = defineRpc({
  name: "issues.list",
  input: z.object({
    scope: issueScope,
    state: z.enum(["opened", "closed", "all"]).default("opened"),
    search: z.string().optional(),
    page: z.number().int().min(1).default(1),
  }),
  output: z.object({
    items: z.array(issueItemSchema),
    nextPage: z.number().int().nullable(),
  }),
});

export const mergeRequestGetRpc = defineRpc({
  name: "mr.get",
  input: z.object({ projectPath: z.string(), iid: z.number().int() }),
  output: mergeRequestItemSchema.extend({
    description: z.string(),
    reviewers: z.array(z.string()),
    mergeStatus: z.string().nullable(),
    headPipeline: z.string().nullable(),
    approvals: z.string().nullable(),
    notes: z.array(noteSchema),
  }),
});

export const issueGetRpc = defineRpc({
  name: "issue.get",
  input: z.object({ projectPath: z.string(), iid: z.number().int() }),
  output: issueItemSchema.extend({
    description: z.string(),
    notes: z.array(noteSchema),
  }),
});

export const attachmentItemSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.string().url(),
  text: z.string(),
  resourceType: z.string(),
});

export const attachmentSearchRpc = defineRpc({
  name: "gitlab.search",
  input: z.object({ query: z.string() }),
  output: z.object({ items: z.array(attachmentItemSchema) }),
});

export type MergeRequestItem = z.infer<typeof mergeRequestItemSchema>;
export type IssueItem = z.infer<typeof issueItemSchema>;
export type MergeRequestDetail = z.infer<typeof mergeRequestGetRpc.output>;
export type IssueDetail = z.infer<typeof issueGetRpc.output>;
export type ProjectDetection = z.infer<typeof projectDetectRpc.output>;
