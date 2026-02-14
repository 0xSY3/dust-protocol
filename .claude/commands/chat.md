---
name: chat
description: Send a message to the team or a specific teammate through CodePilot
---

Help the user send a message to their team:

1. Ask who they want to message: the whole team or a specific person
   - Use `codepilot_team_status` to show who's online so they can pick
2. Ask what they want to say (or use the argument if provided)
3. Automatically include relevant context:
   - If the user has an active file open, mention it
   - If they've been making changes, briefly note what area they're working in
4. Use `codepilot_send_message` MCP tool to send it
5. Confirm the message was sent
