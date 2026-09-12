# ParkTech

HackWesTX VII. Two people, two machines, two parallel Claude sessions.
Read `PRD.md` for the full plan and `contracts/README.md` for the interface.

## Your lane

| Path | Owner |
|---|---|
| `run.py`, `calibrate.py`, `parktech/`, `config/` | Session A (Lavneet, vision) |
| `web/` | Session B (Sharva, frontend) |
| `contracts/` | shared |

**Never edit files outside your lane.** If you believe a file in the other lane needs to change,
stop and tell the user. Do not fix it yourself. The other session is working in that file right
now and cannot see your edit.

## contracts/

`contracts/state.schema.json` and `contracts/layout.schema.json` are the interface between the
lanes. After the first hour they are **additive only**: you may add a field, never rename or
remove one. Any change here requires the user to sync with the other session first.

The frontend must keep working against `VITE_USE_MOCK=1` at all times. It never requires the
Python pipeline to be running.

## Git

- **Never push to `main`.** Every change is a PR reviewed by the other teammate.
- Branch as `vision/<thing>` or `web/<thing>`.
- **One file per commit.** Commit each file the moment you finish editing it, before moving on
  to the next file.
- Space commit timestamps apart. Do not let a batch land on the same second.
- Open the PR with `gh pr create`.
- If you are blocked on an unmerged PR, stack the next branch on top of it rather than waiting.
- **Never add AI attribution** to a commit message or a PR description. No `Co-Authored-By:
  Claude`, no `Generated with Claude Code`, nothing of that kind. This is a hard rule.

## Conventions

- No em dashes anywhere: code, comments, docs, commit messages.
- Prefer a single `python run.py` entrypoint over server plus curl workflows.
- Do not fine-tune any model. Pretrained YOLO only. See the domain-gap section of `PRD.md`.
- UI follows `web/docs/DESIGN.md`.

## Kill switches

These are in `PRD.md` and they are real. If the go/no-go at hour 2 fails, say so plainly rather
than debugging past it.
