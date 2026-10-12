# inkline evals

Behaviour tests for the skill, run with Claude Code's plugin eval runner (v2.1.269+). They check what
Claude does with inkline, not the engine itself; the engine has its own tests (`npm test` in
`skills/inkline/engine`).

| Case | Checks |
|---|---|
| `draws-from-prompt` | a "draw a …" request fires the skill and is handled end to end or stops at the setup question |
| `asks-before-setup` | even with "just do it", nothing is installed without the user's yes |
| `saves-custom-style` | a described look becomes a reusable style file via `inkline style` |
| `ignores-unrelated` | the skill stays out of a request that only mentions pencils |

```bash
claude plugin eval . --allow-tools Bash Write          # all cases, with/without-plugin comparison
claude plugin eval . --case asks-before-setup --runs 1 --ablation none --allow-tools Bash Write
```

Each run uses your Claude credentials and counts against your plan. Results land in `evals/results/`
(git-ignored) with an HTML report.
