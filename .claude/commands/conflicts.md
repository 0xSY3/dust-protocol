---
name: conflicts
description: Check if your changes conflict with what teammates are working on
---

Check for conflicts between your work and the team's:

1. Run `git diff --name-only HEAD` to get the list of files you've changed
2. Use `codepilot_check_conflicts` MCP tool with those file paths
3. For any conflicts found, clearly show:
   - Which file has a conflict
   - Who else changed it and when
   - What they changed (summary)
   - Whether it's a hard conflict (they're actively editing) or soft (recently changed)
   - Recommended action (wait, coordinate, or safe to proceed)
4. If no conflicts, confirm all clear
5. If there are conflicts, offer to message the teammate via `codepilot_send_message`
