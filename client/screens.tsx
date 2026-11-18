import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { GitLabBrowser, GitLabProjectPanelBody } from "./browser";

export function GitLabScreen({ theme, layout, host }: PluginScreenProps) {
  return (
    <GitLabBrowser
      theme={theme}
      layout={layout}
      mode="mine"
    />
  );
}

export function GitLabWorkspacePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <GitLabProjectPanelBody
      theme={theme}
      layout={layout}
      workspaceId={workspaceId}
    />
  );
}
