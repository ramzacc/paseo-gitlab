import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  attachmentSearchRpc,
  connectionGetRpc,
  connectionTestRpc,
  issueGetRpc,
  issuesListRpc,
  mergeRequestGetRpc,
  mergeRequestsListRpc,
  projectDetectRpc,
} from "./shared/rpc";
import { connectionSettings, credentialSettings } from "./shared/settings";
import { createHandlers } from "./server/handlers";

export default function contribute(server: PluginServerContext) {
  const connection = server.registerSettings(connectionSettings);
  const credentials = server.registerSettings(credentialSettings);
  const handlers = createHandlers(connection, credentials);

  server.handle(connectionGetRpc, handlers.connectionGet);
  server.handle(connectionTestRpc, handlers.connectionTest);
  server.handle(projectDetectRpc, handlers.projectDetect);
  server.handle(mergeRequestsListRpc, handlers.mrsList);
  server.handle(issuesListRpc, handlers.issuesList);
  server.handle(mergeRequestGetRpc, handlers.mrGet);
  server.handle(issueGetRpc, handlers.issueGet);
  server.handle(attachmentSearchRpc, handlers.attachmentSearch);

  return () => {};
}
