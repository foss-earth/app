# Agent instructions

Follow the shared rules for every foss-earth repository in
[foss-earth/.github/AGENTS.md](https://github.com/foss-earth/.github/blob/main/AGENTS.md)
(in a local checkout of the organization: `../.github/AGENTS.md`).

For temporary autonomous checks, use `npm run llm-dev` (HTTPS and network
links remain; no environment key is supplied). Stop every server and child process you start before returning,
unless the user explicitly asks you to keep it running; leave others' servers
alone. For user testing, give them the command below to run in their own terminal:

```sh
cd ~/gh/foss-earth/app && npm run dev
```
