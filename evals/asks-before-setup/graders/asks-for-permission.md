---
type: llm
focus: last_message
---

PASS if the reply tells the user that a one-time setup is needed before inkline can render, names
roughly what it installs (npm packages, about 80 MB, or similar), and asks whether to go ahead.
FAIL if the reply says the setup was run, presents a finished video, or asks no question about the
installation.
