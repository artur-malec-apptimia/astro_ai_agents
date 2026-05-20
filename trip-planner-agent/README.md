# Trip Planner Agent

An AI agent that plans multi-day trips: fetches live weather, searches Yelp for activities and dining, and writes a structured itinerary and packing list to Notion.

Built with [`@astropods/adapter-core`](https://docs.astropods.com) and Claude (`claude-sonnet-4-6`) as the orchestrator. Based on the [Postman Trip Planner Agent template](https://www.postman.com/templates/agents/trip-planner-agent/).

## What it does

1. Determines today's date
2. Fetches a weather forecast (or historical weather for past dates) via [Open-Meteo](https://open-meteo.com/)
3. Searches [Yelp Fusion](https://docs.developer.yelp.com/docs/fusion-intro) for local activities and restaurants
4. Creates a Notion page with:
   - A daily schedule database (day, date, weather, activities, dining)
   - A packing list

## Tools

| Tool | Description |
|------|-------------|
| `get_todays_date` | Returns today's date and day of week |
| `get_weather_forecast` | 7-day forecast from Open-Meteo |
| `get_historical_weather` | Past weather from Open-Meteo archive |
| `search_yelp` | Search businesses via Yelp Fusion |
| `create_notion_trip_plan_template` | Create a Notion page + schedule database |
| `add_weather_to_notion_database` | Add a daily row to the schedule database |

## Requirements

- [Bun](https://bun.sh/) v1+
- [Astropods CLI](https://docs.astropods.com) (`ast`)
- Docker (for `ast dev`)
- API keys (see Configuration)

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```
ANTHROPIC_API_KEY=...
YELP_API_KEY=...
NOTION_BEARER_TOKEN=...
NOTION_PARENT_PAGE_ID=...
```

- **`ANTHROPIC_API_KEY`** — [Anthropic Console](https://console.anthropic.com/)
- **`YELP_API_KEY`** — [Yelp Fusion](https://docs.developer.yelp.com/docs/fusion-intro)
- **`NOTION_BEARER_TOKEN`** — [Notion integrations](https://www.notion.so/my-integrations)
- **`NOTION_PARENT_PAGE_ID`** — The Notion page ID under which trip pages will be created (share that page with your integration)

## Development

```bash
bun install
bun test          # run all 33 unit tests
ast dev           # start local playground at http://localhost:3100
```

## Example prompt

> Plan a 3-day trip to Paris from June 10–12. I enjoy art museums and fine dining.

## Project structure

```
agent/
  index.ts          # AgentAdapter entry point
  executor.ts       # Tool dispatch
  tools/
    definitions.ts  # Claude tool schemas
    date.ts
    weather.ts
    yelp.ts
    notion.ts
  tests/
    date.test.ts
    weather.test.ts
    yelp.test.ts
    notion.test.ts
    executor.test.ts
Dockerfile
astropods.yml
```
