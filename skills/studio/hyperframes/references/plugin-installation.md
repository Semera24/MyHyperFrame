# Running from HyperFrames Desktop

These skills are the app's own plugin (`hyperframes-desktop`). The app installs them and replaces them when it updates, so the standalone update steps in the project's AGENTS.md do not apply here:

- Do not run `hyperframes skills`, `skills update`, `skills check` or `npx skills add`, and do not download another copy of a skill. Report a skill that is missing instead.
- Run `hyperframes <command>` as is: the app puts the CLI version it ships first on the path. There is no `plugin-cli.mjs` launcher.
- Run a skill's own script with `node <SKILL_DIR>/scripts/<name>.mjs`, from the project folder.
- Treat the skills folder as read-only. Outputs and temporary work go in the project.
