# Dupy bridge

`.github/workflows/dupy-bridge.yml` POSTs GitHub issue activity to an external webhook. It runs when an issue is opened, edited, reopened, closed, or labeled, and when an issue comment is created or edited. Comments on pull requests are included; the payload sets `is_pull_request` to `true` for those and `false` for everything else.

The job runs on `ubuntu-latest` with `permissions: {}` (the workflow token has no scopes) and a one-minute timeout. `jq` reads titles and bodies from `$GITHUB_EVENT_PATH` and writes them as JSON strings.

| Field | Value |
|---|---|
| `source` | `"github"` |
| `event` | `issues` or `issue_comment` |
| `action` | the webhook action (`opened`, `created`, `labeled`, …) |
| `repo` | `owner/name` |
| `issue_number` | issue number |
| `issue_title` | issue title |
| `issue_url` | issue `html_url` |
| `issue_state` | `open` or `closed` |
| `is_pull_request` | `true` when the issue is a pull request |
| `actor` | user who triggered the event |
| `comment_id` | comment id, or `null` on issue events |
| `comment_url` | comment `html_url`, or `null` on issue events |
| `comment_author` | comment author's login, or `null` on issue events |
| `body` | comment body for `issue_comment`, otherwise the issue body, cut off at 6000 characters |

## Secrets

Two repository Actions secrets are required:

| Secret | Purpose |
|---|---|
| `DUPY_WEBHOOK_URL` | URL that receives the POST |
| `DUPY_WEBHOOK_KEY` | Bearer token |

Set them under **Settings > Secrets and variables > Actions > New repository secret**.

When `DUPY_WEBHOOK_URL` is empty, the job prints a notice and exits successfully, so the workflow can land before the secrets exist. A URL that is set and then rejects the request fails the job.

## Loop guard

The job is skipped when the comment body (`issue_comment`) or the issue body (`issues`) contains the literal marker `<!-- dupy -->`.

Include that marker in any comment or issue body this integration writes back to GitHub. GitHub hides an HTML comment in the rendered view. The workflow sees the marker in the event payload and skips the job.

## Auth header

The request is:

```
POST <DUPY_WEBHOOK_URL>
Content-Type: application/json
Authorization: Bearer <DUPY_WEBHOOK_KEY>
```

The header is the curl `-H "Authorization: Bearer ${WEBHOOK_KEY}"` line in the workflow. If the receiver expects a different header, change that line and keep the value in `DUPY_WEBHOOK_KEY`. For a custom header named `X-Api-Key`:

```yaml
-H "X-Api-Key: ${WEBHOOK_KEY}"
```
