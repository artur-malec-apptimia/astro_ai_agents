import type OpenAI from 'openai';

export const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_todays_date',
      description:
        "Returns today's date and day of week. Use this to determine whether trip dates are in the past (use historical weather) or future (use forecast).",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather_forecast',
      description:
        'Gets weather forecast for future dates at a location. Resolve city names to latitude/longitude from your training knowledge.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude of the destination' },
          longitude: { type: 'number', description: 'Longitude of the destination' },
          start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        },
        required: ['latitude', 'longitude', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_historical_weather',
      description: 'Gets historical weather data for past dates at a location.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude of the destination' },
          longitude: { type: 'number', description: 'Longitude of the destination' },
          start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        },
        required: ['latitude', 'longitude', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_yelp',
      description:
        'Searches Yelp for local businesses, activities, and restaurants at the destination. Call multiple times for different categories (e.g. "restaurants", "museums", "outdoor activities").',
      parameters: {
        type: 'object',
        properties: {
          term: {
            type: 'string',
            description: 'Search term e.g. "restaurants", "museums", "outdoor activities"',
          },
          location: { type: 'string', description: 'City or address to search near' },
          limit: { type: 'number', description: 'Max results to return (1-50)' },
        },
        required: ['term', 'location', 'limit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_notion_trip_plan_template',
      description:
        'Creates a Notion page with a Trip Schedule database and Packing List. Call this FIRST before adding daily entries. Returns trip_page_id and trip_schedule_database_id needed for subsequent calls.',
      parameters: {
        type: 'object',
        properties: {
          trip_page_title: {
            type: 'string',
            description: 'Title for the trip page e.g. "Paris Trip - June 2025"',
          },
          packing_list: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of items to pack for the trip',
          },
        },
        required: ['trip_page_title', 'packing_list'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_weather_to_notion_database',
      description:
        "Adds a single day's entry to the Notion trip schedule database. Call once per day of the trip after create_notion_trip_plan_template.",
      parameters: {
        type: 'object',
        properties: {
          trip_schedule_database_id: {
            type: 'string',
            description: 'Database ID returned by create_notion_trip_plan_template',
          },
          day_of_week: { type: 'string', description: 'e.g. "Monday"' },
          trip_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          weather_summary: { type: 'string', description: 'Weather description for the day' },
          activities_planned: { type: 'string', description: 'Activities planned for the day' },
          dining_plan: { type: 'string', description: 'Dining plans for the day' },
        },
        required: [
          'trip_schedule_database_id',
          'day_of_week',
          'trip_date',
          'weather_summary',
          'activities_planned',
          'dining_plan',
        ],
      },
    },
  },
];
