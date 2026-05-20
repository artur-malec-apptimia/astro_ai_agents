import { getTodaysDate } from './tools/date.js';
import { getWeatherForecast, getHistoricalWeather } from './tools/weather.js';
import { searchYelp } from './tools/yelp.js';
import { createNotionTripPlanTemplate, addWeatherToNotionDatabase } from './tools/notion.js';

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'get_todays_date':
      return JSON.stringify(getTodaysDate());

    case 'get_weather_forecast':
      return JSON.stringify(
        await getWeatherForecast(
          input.latitude as number,
          input.longitude as number,
          input.start_date as string,
          input.end_date as string,
        ),
      );

    case 'get_historical_weather':
      return JSON.stringify(
        await getHistoricalWeather(
          input.latitude as number,
          input.longitude as number,
          input.start_date as string,
          input.end_date as string,
        ),
      );

    case 'search_yelp':
      return JSON.stringify(
        await searchYelp(
          input.term as string,
          input.location as string,
          input.limit as number,
        ),
      );

    case 'create_notion_trip_plan_template':
      return JSON.stringify(
        await createNotionTripPlanTemplate(
          input.trip_page_title as string,
          input.packing_list as string[],
        ),
      );

    case 'add_weather_to_notion_database':
      return JSON.stringify(
        await addWeatherToNotionDatabase(
          input.trip_schedule_database_id as string,
          input.day_of_week as string,
          input.trip_date as string,
          input.weather_summary as string,
          input.activities_planned as string,
          input.dining_plan as string,
        ),
      );

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
