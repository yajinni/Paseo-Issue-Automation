# Setup Walkthrough Plan

**Status:** Living planning document  
**Last updated:** 2026-08-06  
**Implementation status:** Planning only. The setup walkthrough code has not been changed yet.

This document records the product and workflow decisions approved during planning for the simplified Paseo Issue Automation setup walkthrough. It should be treated as the source of truth when implementation begins.

## Goals

The setup walkthrough should:

- guide a user from an unconfigured installation to a working first repository;
- hide technical options until they are needed;
- automatically detect local tools and settings whenever possible;
- explain failures in plain language and provide a focused recovery action;
- preserve completed steps when a later check fails;
- use a consistent **Recheck** pattern throughout the walkthrough;
- allow the walkthrough to be run again later to configure additional repositories.

## Shared walkthrough behavior

- Each setup page automatically checks its requirements when opened.
- Each page has a visible **Recheck** button.
- Focused recheck buttons may also appear beside a blocked step.
- Rechecking preserves every selection that is still valid.
- A failed check expands only the affected section; completed sections collapse into compact success rows.
- Technical addresses, versions, paths, timestamps, and diagnostics belong under collapsed **Technical details** areas unless the user needs them to recover.
- The walkthrough should use progressive disclosure rather than showing every possible option at once.
- The setup should not perform paid or destructive test work before a repository and workspace are ready.

---

# Page 1: Connect and Verify Paseo

Everything in this section belongs on one first page. Daemon connection and `paseo` CLI verification must not be split into separate pages.

## Initial message

> **Set up Paseo**  
> We’ll find Paseo on this computer, connect to it, and make sure its command-line tools are ready.

The walkthrough assumes Paseo is running on the same computer or in the same local host/container environment.

## Daemon detection

Automatically try to locate the Paseo daemon. The implementation should account for:

1. a previously saved working address;
2. Paseo’s normal local address;
3. `localhost` equivalents;
4. supported host-gateway or shared-network addresses when the dashboard is containerized.

During detection, show a simple status such as:

> Looking for the Paseo daemon…

Do not show an address field unless automatic detection fails.

## Daemon found

Show a compact success state:

> **Paseo found**

Collapsed technical details may show:

- daemon address;
- daemon version;
- connection status;
- compatibility status.

After discovery, perform an authenticated daemon operation to determine whether a password is required.

## Password required

When the daemon is reachable but requires authentication, expand a password section:

> **Enter your Paseo password**  
> Paseo is running, but it requires a password before we can continue.

Controls:

- Password field
- Show password
- **Connect**
- **Remember this connection securely**, enabled by default

Password storage requirements:

- use the operating system or application credential vault;
- store only encrypted/secure credential material;
- never place the password in ordinary settings, logs, diagnostic exports, browser local storage, or a connection URL;
- if secure persistent storage is unavailable, automatically use session-only storage and explain that limitation.

An incorrect password should not force the user to re-enter the daemon address.

## Automatic detection fails

Only after automatic detection fails, show:

> **Paseo wasn’t found automatically**

Controls:

- daemon address field;
- **Connect**;
- **Try automatic detection again**;
- expandable **Where do I find this?** instructions.

Password entry remains a separate step after the address is validated.

## Compatibility checks

A successful daemon connection must also verify:

- daemon version;
- API/capability compatibility;
- whether the connected daemon is suitable for this automation version.

## Verify the `paseo` command

After the daemon connects, check for the `paseo` command used by coding agents.

The check must run in the same execution environment that will launch coding automation, not in the browser.

The basic check is equivalent to:

```bash
paseo --version
```

Also confirm that the automation process can execute the detected command.

### CLI detected

Show:

> **Paseo command ready**

Collapsed details may include:

- command path;
- CLI version;
- daemon version;
- CLI/daemon compatibility.

### CLI not detected

Keep the daemon connection marked successful. Show:

> **Install the Paseo command-line tool**  
> Julie’s Dashboard connected to Paseo, but the `paseo` command is not available to coding agents yet.

The page should guide the user through enabling or installing the command from inside Paseo. Include:

1. how to open Paseo;
2. where to navigate;
3. which installation action to use;
4. what successful installation looks like.

Controls:

- **Open Paseo**
- **Copy instructions**
- **Check again**

The focused recheck reruns only the CLI checks and does not discard the working daemon connection.

## Page-level Recheck

The persistent **Recheck** button reruns:

- daemon detection;
- authentication status;
- version compatibility;
- `paseo` CLI detection;
- CLI/daemon compatibility.

It preserves the saved address and securely stored password.

## Completion requirements

The user may continue only when:

- the daemon is found;
- authentication succeeds;
- versions/capabilities are compatible;
- the `paseo` command is detected and executable.

Successful summary:

```text
✓ Paseo daemon connected
✓ Authentication successful
✓ Version compatible
✓ Paseo command ready
```

Primary action: **Continue**

---

# Page 2: Choose Provider/Coding Harness

Use the user-facing term **Provider/Coding Harness**.

## Initial message

> **Choose a Provider/Coding Harness**  
> This is the coding tool Paseo will use to write and review your code.

Automatically request available Provider/Coding Harnesses from Paseo.

## Harness list

Show only harnesses that Paseo reports as:

- detected;
- available;
- ready to use.

Do not show unavailable, unauthenticated, uninstalled, disabled, or misconfigured harnesses.

If none are available:

> **No available Provider/Coding Harnesses were found.**  
> Open Paseo and install or configure a coding provider, then return here and select **Recheck**.

Controls:

- **Open Paseo**
- **Recheck**

## One harness for coding and review

The selected Provider/Coding Harness applies to both:

- the coding agent;
- the review agent.

The user must not select separate harnesses for those roles.

Changing the harness clears model selections that are not valid for the new harness and loads the new harness’s model data.

## Coding model

Show:

> **Coding model**  
> This model will make changes to your repositories.

Fields:

- Model
- Thinking level

## Review model

Show:

> **Review model**  
> This model will check the coding agent’s work.

Fields:

- Model
- Thinking level

The coding and review models may be the same or different, but both must come from the selected Provider/Coding Harness.

## Thinking levels

Thinking options should come from the selected harness/model when exposed.

- Show only supported choices.
- Preserve the harness’s labels.
- Recalculate choices when the model changes.
- It is acceptable to show **Thinking level: None** when no configurable thinking level exists.

## Review model explanation

Show an explanatory note:

> **Choosing a review model**
>
> You can choose a lighter model to perform a quick check and catch obvious mistakes. A human or a web-based ChatGPT review can then perform the full pull request review later. You’ll configure that review workflow on another setup page.
>
> You can also choose a stronger model to perform the pull request review immediately after the coding work is completed.

This explains workflow choices. The UI must not claim that it can reliably rank every model’s intelligence or cost unless the harness exposes dependable metadata.

## Harness exposes no models

Show exactly this warning:

> **No models were exposed by this Provider/Coding Harness. It will use its own defaults. Make sure this is not an error.**

Display:

```text
Model: Harness default
Thinking level: None
```

Include:

- **Recheck**
- **Open Paseo**
- expandable technical details
- a confirmation that the user has checked the harness configuration before continuing

A missing model list should not always block setup because some harnesses legitimately manage their own defaults.

## Testing policy

Do not send a real coding-model request on this page. A real execution test belongs after repository/workspace setup so it does not consume paid usage, create unnecessary agent sessions, or fail due to a missing repository.

## Recheck behavior

The page-level **Recheck** reloads:

- available harnesses;
- availability state;
- model lists;
- thinking levels;
- saved selections.

Preserve selections when still valid. If a selected harness or model disappears, clear only the invalid selection and explain what changed.

## Completion summary

Example:

```text
Provider/Coding Harness
OpenCode

Coding agent
Model: [selected model]
Thinking level: High

Review agent
Model: [selected model]
Thinking level: Low
```

Primary action: **Continue to repositories**

---

# Page 3: Connect a GitHub Repository

The walkthrough configures one repository at a time. The user can rerun setup later to add more repositories.

## Check GitHub CLI

Automatically check that `gh` is installed and executable in the automation environment.

Equivalent basic check:

```bash
gh --version
```

### GitHub CLI missing

Show installation instructions appropriate to the detected operating environment.

Controls:

- **Copy install command**
- **Check again**

Keep prior Paseo and model configuration intact.

## Check authentication

Determine whether GitHub CLI is authenticated and which account is active.

### Not signed in

Show:

> **Sign in to GitHub**  
> Sign in with the account that owns or has access to the repository you want to automate.

Primary action: **Sign in with GitHub**

Use GitHub CLI’s browser login flow. After login, automatically recheck. Also provide:

- **I’ve finished signing in — Check again**

### Signed in

Show a compact account row containing:

- active username;
- GitHub host;
- connected status.

Never expose authentication tokens.

## Configure Git credentials

Verify that ordinary Git operations can use the authenticated account, including GitHub CLI credential-helper integration. The setup must not assume that successful `gh` authentication automatically proves clone/push readiness.

## Load repositories

Load all repositories accessible to the active authenticated account, including:

- owned repositories;
- collaborator repositories;
- permitted organization repositories;
- public and private repositories available to the credentials.

The selector should support:

- search by repository name;
- owner/organization display;
- visibility;
- archived state;
- permission level;
- default branch;
- incremental loading or pagination for large accounts.

A repository should be selectable only when the automation has sufficient access for its intended workflow, including reading, cloning/fetching, creating/pushing branches, opening pull requests, and managing the required issue workflow.

Repositories that are visible but unusable may be shown disabled with a clear reason, such as read-only access, archive state, or missing organization authorization.

## Repository controls

Provide:

- **Refresh repositories** — reload using the current account;
- **Change GitHub account** — open account controls;
- **Switch account** — select another account already authenticated;
- **Add another account** — authenticate an additional account;
- **Reauthenticate current account** — repair expired credentials or permissions;
- **Log out of this account**.

After an account change, refresh the list. Preserve the selected repository only when the newly active account can still use it.

Provide troubleshooting for missing organization repositories, including possible organization/SSO authorization, without showing that warning unnecessarily.

## Select base branch

After a repository is selected, load its branches.

Show:

> **Choose the base branch**  
> Each issue branch will start from this branch, and pull requests will target this branch.

Automatically select and mark the repository’s default branch as recommended. Allow another readable branch to be selected through a searchable control.

A protected base branch is valid and should not be treated as an error when work is expected to arrive through pull requests.

## Recheck behavior

The page-level **Recheck** reruns:

- GitHub CLI detection;
- authentication;
- active account detection;
- Git credential integration;
- repository access;
- selected repository permissions;
- selected branch availability.

**Refresh repositories** remains a narrower action that reloads only repository data.

## Completion summary

Example:

```text
✓ GitHub CLI ready
✓ Signed in as [username]
✓ Git credentials ready

Repository
owner/repository

Base branch
main
```

---

# Issues Setup

## Issue-selection modes

Ask:

> **Choose which issues Paseo should work on**

### Recommended labels — default

Only open issues marked with the recommended readiness label enter automation.

This is the default because it allows planning and discussion issues to exist without starting automatically.

### All open issues

Every open issue is considered automatically.

Closed issues and pull requests are never treated as coding work.

“All open issues” still requires each issue to pass the installed automation issue-template validation and native dependency checks.

## Recommended labels

The setup page has an expandable explanation of the labels and their meanings.

Planned label set:

| Label | Meaning |
|---|---|
| `paseo:ready` | Issue is approved and eligible for automation |
| `paseo:queued` | Issue is waiting for its turn |
| `paseo:coding` | Coding agent is currently working on the issue |
| `paseo:review-queued` | Coding is complete and the pull request is waiting for review |
| `paseo:reviewing` | Review is currently running |
| `paseo:changes-requested` | Review found changes that must be made |
| `paseo:fixing` | Coding agent is applying requested fixes |
| `paseo:review-failed` | The review process could not be completed |
| `paseo:failed` | Coding automation could not complete the issue |
| `paseo:needs-attention` | Automation requires user intervention |

Do not invent a `paseo:blocked` label. GitHub’s native dependency relationships are the source of truth for blocking.

Do not require a separate completion label. Completion is represented by the merged pull request and closed issue.

When recommended labels are selected, setup completion installs missing labels. Existing matching labels are reused. Do not silently overwrite user-customized colors or descriptions.

## Required automation issue template

The setup must tell the user:

> **An automation issue template will be installed**
>
> Issues must follow this template before Paseo can accept them. Your planning AI should use the template when creating issues so the coding agent receives complete instructions, acceptance criteria, and validation requirements.

The template is installed for both issue-selection modes.

The issue-selection mode controls which issues are considered. The template controls whether an issue is sufficiently defined to run.

The final template should require, at minimum:

- objective;
- background/context;
- requested changes;
- in-scope areas;
- out-of-scope areas;
- acceptance criteria;
- required validation;
- security/privacy considerations;
- dependency information;
- completion requirements.

The template must instruct planning AIs to create native GitHub `blocked by` relationships instead of expressing dependencies only in prose.

## Invalid issues

An issue that does not satisfy the required template must not enter coding.

Expected behavior:

1. leave the issue open;
2. apply `paseo:needs-attention`;
3. remove it from the runnable queue;
4. in recommended-label mode, remove `paseo:ready` so labels do not conflict;
5. add a comment explaining which required sections are missing or invalid;
6. recheck after the issue is edited;
7. restore eligibility when it becomes valid.

## Processing order

Processing order is based on issue number, lowest first, but only among issues that are currently eligible to run.

Scheduler behavior:

1. inspect the lowest-numbered candidate;
2. check its native GitHub blockers;
3. start it if all blockers are satisfied;
4. if it is blocked, temporarily skip it and inspect the next-lowest candidate;
5. automatically reconsider skipped blocked issues on later scheduling passes.

Example:

```text
#101 — blocked by #110
#102 — ready
#103 — ready
```

The controller starts `#102`. When `#101` later becomes unblocked, it returns to the front of the eligible queue because it has the lowest issue number.

## Dependency source of truth

Use only GitHub’s native issue dependency relationships.

Do not infer dependencies from:

- parent issues;
- sub-issues;
- issue-body text;
- task lists/checklists;
- issue references;
- phrases such as “after #123.”

Parent/sub-issue hierarchy and execution dependency remain separate concepts. If execution order matters, the planning AI or user must create a native `blocked by` relationship.

If a native blocker cannot be inspected safely, do not guess that it is complete.

## No pre-coding human approval

The Issues Setup page must not include a human-approval-before-coding option. The purpose of this system is automated execution.

## Label/template installation timing

Install the selected recommended labels and required issue template at the end of the overall setup process, not immediately when the user first clicks the option.

---

# PR Review Setup

This is one progressive page. Web ChatGPT configuration is a conditional section inside this page rather than a separate required page.

## Confirm review workflow

Ask the user to explicitly choose or confirm one of two workflows. Do not infer the workflow solely from the selected model.

### Quick review now, full review later

The selected review model performs a focused preliminary check. A human or Web ChatGPT performs the full pull request review afterward.

### Full pull request review immediately

The selected review model performs the full pull request review immediately after coding completes.

## Review rounds

A review round consists of:

1. reviewing the current exact pull-request commit;
2. approving or requesting changes;
3. when changes are requested, giving findings to the coding agent for one correction pass;
4. reviewing the updated exact commit in the next round.

The initial review counts as round one.

## Full PR review immediately

For this workflow, the main user setting is:

> **How many review and correction rounds should be allowed?**

If the maximum full-review rounds are exhausted while blocking findings remain:

- stop automated correction rounds;
- leave the PR open/draft as appropriate;
- apply `paseo:changes-requested`;
- apply `paseo:needs-attention`;
- add a clear PR comment explaining that the full-review limit was reached.

Use `paseo:review-failed` only when the review process itself could not run, not when a successful review found unresolved problems.

## Quick review

Ask:

> **How many quick-review and correction rounds should be allowed?**

The quick review is a preliminary aid, not the final gatekeeper.

### Quick-review prompt purpose

Show the quick-review prompt/instructions on the page.

Its job is to verify that the coding agent:

- followed the GitHub issue instructions;
- made the requested changes;
- satisfied the acceptance criteria;
- ran the required validation;
- did not leave obvious mistakes, missing work, broken tests, unrelated changes, or direct contradictions.

It should not attempt a broad architecture or repository-wide review.

The structured result should cover:

- requirements checked;
- acceptance criteria checked;
- validation checked;
- obvious problems;
- unrelated changes;
- decision;
- concrete correction instructions.

The default prompt may be visible and copyable during setup, but setup-time editing is not required.

### Quick review passes

Continue to the selected full-review method.

### Quick-review limit reached with unresolved findings

Do not stop the PR workflow and do not apply `paseo:needs-attention` solely because the lightweight reviewer still wants work.

Instead:

1. stop additional quick-review rounds;
2. preserve all unresolved findings and validation history;
3. hand the PR and findings to the configured full-review stage;
4. clearly indicate that quick review completed with unresolved findings.

Suggested status message:

> **Quick review completed with unresolved findings**  
> The configured quick-review limit was reached. The pull request has been passed to the full review stage with the remaining findings attached.

The full reviewer must independently verify those findings rather than treating them as automatically correct.

## Choose the later full-review method

After selecting quick review, show:

### Manual review

After quick review completes, a person performs the full PR review.

No additional setup is required on this page.

Expected handoff:

- mark the PR ready for human review after the quick stage;
- pause automated full review;
- provide a PR summary containing quick-review results, unresolved findings, and validation evidence;
- show **Waiting for manual review** in the dashboard;
- do not merge automatically.

If quick review reached its limit, the unresolved findings are included for the human reviewer.

### Web ChatGPT review

After quick review completes, Web ChatGPT performs the full PR review.

Selecting this option expands the complete Web ChatGPT configuration below it.

## Full PR review prompt

Show an expandable preview of the heavier full-review instructions.

The full review should:

- verify issue instructions and every acceptance criterion;
- inspect the complete changed-file set and diff;
- examine validation evidence and test coverage;
- identify incomplete work and defects;
- look for regressions in related code and workflows;
- check whether routes, components, services, APIs, schemas, configuration, documentation, or other areas were affected;
- check privacy/security risks;
- check compatibility and migration concerns;
- detect work outside the intended issue scope;
- provide concrete correction requests tied to files and behavior;
- approve only when no blocking finding remains.

The same core review standard applies to:

- immediate full review through the selected Provider/Coding Harness;
- Web ChatGPT full review.

Only delivery instructions and tool-specific protocol should differ.

---

# Conditional Web ChatGPT Setup

This section appears only when the user chooses **Web ChatGPT review**.

## Browser support checks

Automatically check:

- Playwright availability;
- Chromium installation;
- whether the ChatGPT Profile exists;
- whether the ChatGPT Profile can open;
- whether another process currently owns/locks it.

When Chromium is missing, provide:

- **Install Chromium**
- progress/status
- **Recheck**

## User-facing name: ChatGPT Profile

Always call the isolated browser profile **ChatGPT Profile** in normal UI.

Do not use “dedicated browser profile,” “Paseo browser profile,” “Chromium profile,” or “review profile” as the main user-facing name. Technical details may explain its Chromium implementation.

## ChatGPT Profile readiness

The ChatGPT Profile is not ready merely because Chromium is installed or a profile directory exists.

Mark it **Ready** only when:

- Chromium is installed;
- the ChatGPT Profile opens successfully;
- ChatGPT loads;
- a valid signed-in ChatGPT session is present in that profile;
- the selected review chat opens;
- closing and reopening the profile retains the authenticated session.

“Credentials are in the profile” means the profile contains a valid authenticated ChatGPT session. Paseo does not need to know or store the user’s ChatGPT password.

Before login:

```text
ChatGPT Profile
Not signed in
```

Controls:

- **Open ChatGPT Profile**
- **Recheck**

Instructions should tell the user to sign in manually inside the opened window.

After validation:

```text
ChatGPT Profile
✓ Signed in and ready
```

May also show:

- detected account when safely identifiable;
- last verified time;
- **Open ChatGPT Profile**;
- **Recheck**;
- **Sign in with a different account**.

If the session later expires, pause new Web ChatGPT reviews and request sign-in again. Do not automatically classify active PRs as failed merely because reauthentication is required.

## Verify GitHub access from ChatGPT

A ChatGPT login alone is insufficient. Verify that the configured ChatGPT review workflow can access the selected repository and inspect pull requests/changed files using the intended result-delivery protocol.

If access is missing, provide guided setup and **Recheck**.

## Select the review chat

Offer:

### Create a dedicated PR review chat — recommended

Create or initialize a clean chat for PR reviews so unrelated conversation context does not affect results.

### Use an existing chat

Allow selection of an existing chat, with a warning that prior conversation context may influence reviews.

Store a stable chat URL or identifier, not only its visible title.

Controls may include:

- **Create dedicated chat**
- **Choose existing chat**
- **Open selected chat**
- **Recheck**

## Web ChatGPT review rounds

When quick review is followed by Web ChatGPT, configure Web ChatGPT’s maximum full-review rounds separately from the quick-review limit.

If Web ChatGPT reaches its full-review limit with blocking findings still present:

- stop automated correction rounds;
- leave the PR open;
- apply `paseo:changes-requested`;
- apply `paseo:needs-attention`;
- add a clear PR comment explaining that the full-review limit was reached.

## Web ChatGPT readiness check

Before completing the page, run a safe readiness check that does not alter a real issue or publish a fake review.

Verify:

- Chromium launches;
- ChatGPT Profile opens;
- ChatGPT remains signed in;
- selected review chat opens;
- selected repository access works;
- review-result protocol is configured;
- browser closes cleanly and releases its profile lock.

## Recheck behavior

When Web ChatGPT is selected, the page-level **Recheck** covers:

- browser installation;
- ChatGPT Profile availability;
- authenticated ChatGPT session;
- selected chat;
- GitHub access;
- review-protocol readiness.

---

# Review lifecycle state

Do not expand the public GitHub label set merely to distinguish quick versus full review.

Use the common labels:

```text
paseo:review-queued
paseo:reviewing
paseo:changes-requested
paseo:fixing
paseo:review-failed
paseo:needs-attention
```

Store the actual review stage internally, such as:

- `quick`;
- `full-immediate`;
- `full-manual`;
- `full-web-chatgpt`.

---

# Decisions still to finalize

These items were discussed or suggested but are not yet fully locked:

1. The exact local clone/workspace page or automatic flow between repository selection and issue execution.
2. Exact defaults and maximum values for quick-review and full-review round selectors.
3. Exact advanced Issues Setup controls, including concurrency, transient retry limits, and optional exclusion labels.
4. Final issue-template wording, parser/validation rules, label colors, and label descriptions.
5. Final machine-readable quick-review and full-review result protocols.
6. Final first-run/readiness-summary page and the exact safe end-to-end test.
7. Whether any setup step should create a reviewed setup PR versus writing repository-managed resources through another installation workflow.

These should be resolved during continued planning before implementation begins.

# Implementation instruction

When implementation begins:

- inspect the current repository architecture, existing labels, setup UI, issue validation, scheduling, dependency handling, PR-review state, browser setup, tests, and documentation before changing code;
- update code and documentation consistently rather than adding a parallel second workflow;
- migrate or reconcile the existing lifecycle labels carefully;
- preserve native GitHub dependency behavior;
- keep changes on a task-specific branch and deliver them through a reviewed pull request;
- run repository-standard validation plus targeted tests for every changed area;
- do not claim any validation passed unless it was actually run.
