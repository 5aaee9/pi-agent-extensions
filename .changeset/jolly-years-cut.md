---
"@indexyz/dsh-prompt-suggestions": minor
---

First release: show a dim next-message suggestion in the empty dsh composer after a successful live reply, accept it with Tab or Right Arrow without auto-submitting, dismiss it with Escape, and persist a General settings switch. Generation uses the conversation's current model with low reasoning, at most eight recent visible exchanges, a 30-second deadline, no tools, no session writes, and no goal inheritance.
