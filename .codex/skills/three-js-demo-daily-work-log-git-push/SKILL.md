---
name: three-js-demo-daily-work-log-git-push
description: Write the date-specific Three.js demo work log, validate the Vite project, review and stage intended repository changes, commit them, and push the current branch. Use only inside the three-js-demo / simulater repository when the user explicitly asks to summarize today's work and commit or push the code.
---

# Three.js Demo Daily Work Log and Git Push

Apply this workflow only to `/home/lyt/Code/three-js-demo` (remote `simulater`). Do not use it for Sealinx or other projects.

## 1. Confirm project and rules

1. Confirm the repository contains `package.json`, `index.html`, `vite.config.js`, `src/main.js`, and `sim/`.
2. Read `README.md` completely. Also read `工作记录.md` and any `docs/*.md` that describe current constraints. Follow the latest user instruction.
3. Do not modify `/home/lyt/Code/new-sealinx` from this skill. The demo may bridge to Sealinx through `sim/`, but official Sealinx source stays untouched.
4. Resolve the local date using the environment timezone. Use `docs/work_log_YYYY-MM-DD.md` to match the dated-log convention. Keep the cumulative `工作记录.md` unless the user asked to update it.
5. Inspect `git status --short`, the current branch, `git remote -v`, recent commits, staged changes, unstaged changes, and untracked files.
6. Preserve unrelated user changes. Never stage `node_modules/`, `dist/`, `sim/logs/`, `sim/ace_node/`, `sim/__pycache__/`, credentials, private keys, temporary screenshots, or files outside the requested work.

## 2. Audit today's demo work

1. Read all relevant diffs and new files before summarizing them.
2. Group work by subsystem, such as scene/visualization, acoustics and propagation, node UI, communication console, local network simulation, ACE live bridge, SQLite replay, tests, and documentation.
3. Record compatibility effects explicitly. In particular, distinguish:
   - visualization-only changes from acoustic formula changes in `src/acoustics.js` / `src/propagation.js` / `src/wave.js`;
   - local-mode behavior from live/replay bridge contracts in `sim/` and `docs/viz_contract.md`;
   - UI layout changes from Sealinx packet semantics.
4. Separate current changes from existing limitations. Never attribute an already known gap (no Doppler, no refraction, no GLTF AUV) to a new change without evidence.

## 3. Validate the repository

Run the project-required commands from the repository root:

```bash
npm run build
node --test src/*.test.js
python3 sim/test_replay.py
git diff --check
```

For HTML/Markdown/CSS changes, also check applicable embedded JavaScript syntax, page anchors, balanced Markdown fences, and unwanted stale content.

Do not treat `npm run dev` or `./sim/run_live.sh` as required validation. Those start long-running processes and need a real browser or ACE test pack.

Record exact totals and failures. If a test fails, report the real cause; do not delete assertions or skip checks to hide it.

## 4. Write the daily log

Create or update `docs/work_log_YYYY-MM-DD.md` in Chinese with these sections:

- `今日目标`;
- `完成内容` grouped by feature;
- `主要文件`;
- `验证结果` with successful, failed, and skipped checks;
- `后续事项`.

Describe only evidence visible in the working tree and command output. Mention this project-local Skill when it is part of the commit. Do not claim all tests passed when `node --test` or `sim/test_replay.py` reports a failure.

## 5. Review and commit

1. Re-run `git status --short` after writing the log.
2. Stage only intended demo paths, including the work log and any project-local Skill files requested by the user.
3. Review `git diff --cached --stat`, `git diff --cached`, and `git diff --cached --check`.
4. Confirm the work log matches the staged changes and validation state.
5. Use a concise commit subject describing the primary demo outcome.
6. Create the commit and capture `git rev-parse HEAD` plus `git show -1 --stat --oneline`.

## 6. Push safely

1. Push only when the user explicitly requested it.
2. Push the current branch to its configured remote with a normal non-force push, normally `git push origin <branch>`.
3. Never force-push. If rejected, inspect the remote state and report the blocker; do not reset, rebase, or merge unrelated work automatically.
4. Verify the remote-tracking branch points to the new commit and report any remaining working-tree changes.

## 7. Report

Return the work-log link, commit hash and subject, pushed remote/branch, validation results, known failures, and any files left uncommitted.
