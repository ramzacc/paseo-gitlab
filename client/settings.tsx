import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  useToast,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import { settingsRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { connectionGetRpc, connectionTestRpc } from "../shared/rpc";
import { normalizeBaseUrl } from "../shared/url";

export function GitLabSettings({ theme }: PluginSurfaceProps) {
  const getConnection = useRpc(connectionGetRpc);
  const testConnection = useRpc(connectionTestRpc);
  const writeBaseUrl = useRpc(settingsRpc("connection").write);
  const writeToken = useRpc(settingsRpc("connection-token").write);
  const queryClient = useQueryClient();
  const toast = useToast();
  const tokenRef = useRef<SettingsInputHandle>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [feedback, setFeedback] = useState(null as string | null);
  const [error, setError] = useState(null as string | null);

  const connection = useQuery({
    queryKey: ["gitlab", "connection"],
    queryFn: () => getConnection({}),
  });

  useEffect(() => {
    if (connection.data) setBaseUrlDraft(connection.data.baseUrl);
  }, [connection.data]);

  const test = useMutation({
    mutationFn: () => testConnection({}),
    onSuccess: (result) => {
      setError(null);
      const message = `Connected as @${result.username}`;
      setFeedback(message);
      toast.show(message, { variant: "success" });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setFeedback(null);
      setError(message);
      toast.error(message);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!connection.data) throw new Error("Connection settings are not loaded yet");
      const baseUrl = normalizeBaseUrl(baseUrlDraft);
      if (!baseUrl) throw new Error("Enter a GitLab base URL");

      if (tokenDraft.trim()) {
        const tokenResult = await writeToken({
          revision: connection.data.tokenRevision,
          values: { token: tokenDraft.trim() },
        });
        if (tokenResult.status !== "saved") {
          throw new Error(tokenResult.error);
        }
      }

      const baseResult = await writeBaseUrl({
        revision: connection.data.baseUrlRevision,
        values: { baseUrl },
      });
      if (baseResult.status !== "saved") {
        throw new Error(baseResult.error);
      }
      return baseUrl;
    },
    onSuccess: async (baseUrl) => {
      setError(null);
      setFeedback(`Saved connection to ${baseUrl}`);
      setTokenDraft("");
      tokenRef.current?.replaceText("");
      await queryClient.invalidateQueries({ queryKey: ["gitlab", "connection"] });
      await queryClient.invalidateQueries({ queryKey: ["gitlab"] });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setFeedback(null);
      setError(message);
    },
  });

  if (connection.status === "pending") {
    return <Loading />;
  }
  if (connection.status === "error") {
    return (
      <Text style={{ color: theme.colors.statusDanger }}>
        Could not read settings: {connection.error instanceof Error ? connection.error.message : String(connection.error)}
      </Text>
    );
  }

  return (
    <>
      <SettingsSection
        title="Connection"
        info="Use a personal access token with read_api scope. Self-hosted GitLab instances are supported, including a base URL with a path prefix."
      >
        <SettingsCard>
          <SettingsInput
            label="Base URL"
            initialValue={connection.data.baseUrl}
            placeholder="https://gitlab.com"
            onChangeText={setBaseUrlDraft}
          />
          <SettingsInput
            ref={tokenRef}
            label="Personal access token"
            placeholder={
              connection.data.hasToken
                ? "Token saved. Enter a new one to replace it."
                : "glpat-..."
            }
            secureTextEntry
            onChangeText={setTokenDraft}
          />
          <SettingsAction
            label="Token"
            hint={
              connection.data.hasToken
                ? "A token is saved on this host. The plugin never sends it to the app."
                : "No token saved yet."
            }
            actionLabel={save.isPending ? "Saving..." : "Save"}
            disabled={save.isPending}
            onPress={() => save.mutate()}
          />
          <SettingsAction
            label="Connection"
            hint="Calls GET /api/v4/user with the saved settings."
            actionLabel={test.isPending ? "Testing..." : "Test connection"}
            disabled={test.isPending || !connection.data.hasToken}
            onPress={() => test.mutate()}
          />
        </SettingsCard>
      </SettingsSection>

      {feedback ? (
        <Text style={{ color: theme.colors.statusSuccess }}>{feedback}</Text>
      ) : null}
      {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
      {connection.data.username ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>
          Connected as @{connection.data.username}
        </Text>
      ) : null}
    </>
  );
}
