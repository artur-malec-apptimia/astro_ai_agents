---
description: "Fetches open GitHub issues and prioritizes them as high/medium/low using LLM scoring."
---

# GitHub Issue Scorer

This agent reviews GitHub issues and comments to generate a summary, sentiment analysis, and urgency score. It considers reactions, tone, comment volume, and competitive mentions helping teams triage faster and flag issues for escalation.

Trigger the agent using a customizable Slack command, such as /summarize-issue. Then, the agent:

1. Fetches the issue body and all comments, handling pagination automatically

2. Processes the content to:
 - Summarize the overall request or bug report
 - Detect sentiment ( such as frustration, urgency)
 - Count reactions, upvotes, and comment volume
 - Identify competitive mentions or user workarounds
 
3. Posts the analysis to a Slack channel or user

