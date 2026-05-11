---
description: "Fetches YouTube video comments and classifies each as positive, neutral, or negative using OpenAI."
---

# YouTube Comment Analyzer

Analyses the sentiment of YouTube video comments using the YouTube Data API v3 and OpenAI. Given a video URL or ID, the agent fetches comments (with automatic pagination), classifies each one as positive, neutral, or negative in batches, and returns a summary with counts, percentages, and representative examples.

## Usage

Send a message with a YouTube video URL or ID:

```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://youtu.be/dQw4w9WgXcQ
dQw4w9WgXcQ
dQw4w9WgXcQ 200
```

Optionally append a number to control how many comments are fetched (default: 100).

## Required configuration

- `YOUTUBE_API_KEY` — YouTube Data API v3 key from Google Cloud Console
- `OPENAI_API_KEY` — injected automatically via the `openai` model provider
