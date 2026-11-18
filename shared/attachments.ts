import { defineAttachmentSource } from "@getpaseo/plugin";
import { attachmentSearchRpc } from "./rpc";

export const gitlabAttachmentSource = defineAttachmentSource({
  id: "gitlab",
  title: "GitLab issue or merge request",
  icon: "GitMerge",
  pickerTitle: "Attach GitLab issue or merge request",
  searchPlaceholder: "Search, #123, !123, or paste a GitLab URL",
  search: attachmentSearchRpc,
});
