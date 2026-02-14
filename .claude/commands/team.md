---
name: team
description: Show who's online, what they're working on, and active sessions
---

Check the current team status using the `codepilot_team_status` MCP tool.

Display each team member with:
- Their online/idle status
- What file they're currently editing
- What agent they're using (Claude Code, Cursor, etc.)
- How long ago they were last active

Also check for any pending review requests using `codepilot_get_review_feedback`.

Format as a clean, readable summary. Group active members first, then idle ones.
