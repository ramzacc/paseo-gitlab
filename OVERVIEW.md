GitLab adds merge request and issue views to Paseo without leaving the app. Use the workspace panel to see the project for the current checkout, or the GitLab screen in the sidebar to see work assigned to you or created by you. Each view supports state filters, search, and a detail page with the description and comments rendered as Markdown.

Setup needs a GitLab base URL and a personal access token with the `read_api` scope. The base URL defaults to https://gitlab.com and can point at a self-hosted instance, including one served under a path such as https://example.com/gitlab. The token is optional for public projects but is required for personal lists, review requests, and global search. No repository read scope is needed because the plugin only reads GitLab metadata.

The plugin reads merge requests, issues, notes, approvals, pipelines, and project details from the configured GitLab API under `/api/v4`. All requests run on the Paseo daemon host. The app can replace the token but does not read the saved value. Settings and the token are ordinary JSON files on the daemon host; they are not kept in a credential vault.

The integration is read only. It does not comment, approve, merge, or edit GitLab records. Starting an agent from a merge request creates a worktree checked out from that change request through Paseo's GitLab forge support. Starting an agent from an issue creates a new branch worktree. Both actions need a local workspace whose git remote matches the merge request or issue project.

When no token is configured, public project lists and details still load, but comments are hidden because GitLab requires authentication for notes.
