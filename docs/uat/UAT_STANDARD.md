# Sentire UAT Standard

Version 1.0, 12 Nov 2026. Repo copy of the master in the Sentire Software Project (`Sentire Software/UAT/Sentire_UAT_Standard.md`); the master wins if they differ. `UAT_TEMPLATE.xlsx` sits beside this file.

## Why and who

Every process built in any Sentire product ships with a UAT document, and a separate session tests it before the owner signs off. The builder never marks its own work.

| Role | Who | Responsible for |
| --- | --- | --- |
| Developer session | A Claude Code track or a build chat | Building, deploying to the test environment, writing the UAT document, handing off, fixing bugs |
| UAT runner | A separate Claude session using the uat-runner skill | Running every case like a user, marking the workbook, logging bugs in Sentire Projects, recommending |
| Owner | The product owner | Approving each run plan, deciding sign-off, setting fix priority |

It applies to every process that changes what a user sees or does. A bug fix gets a short retest document. A refactor with no visible change needs none; the session report says "No UAT: no user-visible change".

## Developer steps

1. List the acceptance criteria before coding; each becomes at least one case.
2. Deploy to the test environment, never production; confirm migrations, seed data, test accounts, test mailbox and the build shown in the app.
3. Copy `docs/uat/UAT_TEMPLATE.xlsx` to `docs/uat/<process-slug>/UAT_<KEY>_<process-slug>_<build>.xlsx`.
4. Fill every Cover field (no passwords).
5. One row per case on Test Cases, columns A to L only; M to S stay empty for the runner.
6. Meet the Definition of Ready.
7. Hand off: commit the workbook, create the Sentire Projects task "UAT: <process> <build>" (label `uat-ready`, status In review) with the handoff block, and print the block in the session report.
8. Fix and retest: "fixes KEY-n", new build, UAT RETEST block. Expected results change only with the owner's approval.

## Test Cases columns

| Col | Header | Filled by |
| --- | --- | --- |
| A | Case ID (`<KEY>-<MOD>-<NNN>`, never reused) | Developer |
| B | Module | Developer |
| C | Linked Issue | Developer |
| D | Test Scenario | Developer |
| E | Role | Developer |
| F | Preconditions | Developer |
| G | Test Steps (numbered; HUMAN: for person-only steps) | Developer |
| H | Test Data (exact values, or "None") | Developer |
| I | Expected Result (numbered observable checks) | Developer |
| J | Priority (P1, P2, P3) | Developer |
| K | Depends On | Developer |
| L | Side Effects ("None", or IRREVERSIBLE: ...) | Developer |
| M | UAT Status | UAT runner |
| N | Actual Result | UAT runner |
| O | Remarks | UAT runner |
| P | Severity | UAT runner |
| Q | Bug ID | UAT runner |
| R | Tested On | UAT runner |
| S | Tested By | UAT runner |

Never rename, reorder, merge or delete columns; up to 40 cases per workbook.

## Writing good cases

One behaviour per case; cover every criterion with a happy path, its main error path and a permission case; write what the user clicks and sees; make every check observable; prove persistence with a reload; compute figures outside the app; test permissions both ways and include a cross-tenant case where records are shown; use fake data tagged with the case ID; send mail to the test mailbox; name exports; keep human-only cases with HUMAN:; order by dependency; retests keep the original case ID.

## Definition of Ready

Deployed to the test environment with the build matching the Cover; migrations and seed done; every criterion covered with Linked Issue; every case has steps, data and checkable results; figures computed outside the app; permission and cross-tenant cases present where relevant; Side Effects filled; columns M to S empty; known issues listed; file named, placed and committed; UAT task created.

## Handoff block

```
UAT HANDOFF
Product / key:
Process:
Workbook:
Repo / commit:
Build / URL:
Accounts:
Test mailbox:
Cases:
Side effects:
Known issues:
Not ready:
UAT task:
```

## Severity and sign-off

| Severity | Meaning |
| --- | --- |
| Critical | Wrong money, tax or statutory figures; data lost; unauthorized access; core flow blocked; security control bypassed |
| High | Core flow fails with a workaround; compliance output in the wrong format; wrong permission exposing no data |
| Medium | Non-core feature fails; missing validation; misleading message |
| Low | Cosmetic, wording, layout, minor slowness |

Recommendations: Not ready (any Critical or High, or a core flow blocked), Ready with conditions (only Medium or Low, or human-only checks remain), Ready (all in-scope cases passed). The owner accepts by setting the UAT task to Done.
