---
name: review
description: Request team review of your current changes before committing
---

Create a review request for the current session's changes:

1. Run `git diff HEAD` to see current uncommitted changes
2. Run `git diff --stat HEAD` to get a summary of files changed
3. Summarize what changed and why in 2-3 sentences
4. Use `codepilot_request_review` MCP tool to create the review request with:
   - A clear title summarizing the changes
   - The summary as description
   - Let it auto-detect reviewers from online team members
5. Report the review URL and who was notified back to the user
