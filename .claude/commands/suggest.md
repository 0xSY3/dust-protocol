---
name: suggest
description: Get smart prompt suggestions based on team activity and project state
---

Generate actionable next-step suggestions based on what the team is doing:

1. Use `codepilot_suggest_prompt` MCP tool to get team-aware suggestions
2. Use `codepilot_recent_changes` to see what's been happening in the last few hours
3. Use `codepilot_team_status` to see who's online and what they're working on

Present 3-5 actionable suggestions ranked by priority:
- HIGH: Things that directly relate to or build on recent team changes
- MEDIUM: Tasks suggested by review feedback or team conventions
- LOW: General improvements based on project state

Each suggestion should explain:
- WHAT: A specific, ready-to-use prompt
- WHY: The team context that makes this relevant right now

Ask which one the user wants to tackle.
