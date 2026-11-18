import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { GitLabScreen, GitLabWorkspacePanel } from "./client/screens";
import { GitLabSettings } from "./client/settings";
import { gitlabAttachmentSource } from "./shared/attachments";

function GitLabSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="GitMerge"
      active={currentScreen?.screenId === "gitlab"}
      onPress={() => openScreen({ screenId: "gitlab" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "gitlab", title: "GitLab", Component: GitLabScreen });
  client.addSidebarHeaderItem({
    id: "gitlab",
    title: "GitLab",
    Component: GitLabSidebarItem,
  });
  client.addWorkspacePanel({
    id: "gitlab",
    title: "GitLab",
    icon: "GitMerge",
    Component: GitLabWorkspacePanel,
  });
  client.addSettingsScreen({
    id: "connection",
    title: "GitLab connection",
    icon: "Settings",
    Component: GitLabSettings,
  });
  client.addAttachmentSource(gitlabAttachmentSource);
  client.addCommandCenterItem({
    id: "open-gitlab-panel",
    title: "Open GitLab panel",
    icon: "GitMerge",
    keywords: ["merge request", "issue", "gitlab"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("gitlab");
    },
  });
  client.addCommandCenterItem({
    id: "open-gitlab",
    title: "Open GitLab",
    icon: "GitMerge",
    keywords: ["merge request", "issue", "gitlab"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "gitlab" });
    },
  });
  return () => {};
}
