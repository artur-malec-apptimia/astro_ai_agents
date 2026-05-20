---
description: "Plans multi-day trips: fetches live weather, searches Yelp for activities and dining, writes a structured itinerary and packing list to Notion"
tags: ["travel", "planning", "notion", "yelp", "weather"]
capabilities:
  - "Plan a multi-day trip itinerary from a natural language request"
  - "Fetch live weather forecasts (future trips) or historical weather (past dates)"
  - "Search Yelp for local activities and restaurant recommendations"
  - "Write the full itinerary to Notion: daily schedule database and packing list"
integrations:
  - "Open-Meteo (weather forecast and archive)"
  - "Yelp Fusion"
  - "Notion"
---

# Trip Planner

Provide a destination, travel dates, and any preferences. The agent will research the weather, find local activities and restaurants via Yelp, and write a structured itinerary to your Notion workspace — including a daily schedule database and a packing list.

## Required configuration

Run `ast project configure` to set:
- `ANTHROPIC_API_KEY`
- `YELP_API_KEY`
- `NOTION_BEARER_TOKEN`
- `NOTION_PARENT_PAGE_ID`

## Example prompt

> Plan a 3-day trip to Paris from June 10–12. I enjoy art museums and fine dining.
