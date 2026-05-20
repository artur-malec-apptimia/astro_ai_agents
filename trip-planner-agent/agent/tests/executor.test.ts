import { describe, expect, test, spyOn, afterEach } from 'bun:test';
import { executeTool } from '../executor.js';
import * as date from '../tools/date.js';
import * as weather from '../tools/weather.js';
import * as yelp from '../tools/yelp.js';
import * as notion from '../tools/notion.js';

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  spies.length = 0;
});

describe('executeTool', () => {
  test('get_todays_date returns serialized date result', async () => {
    const spy = spyOn(date, 'getTodaysDate').mockReturnValue({ date: '2025-06-01', day_of_week: 'Sunday' });
    spies.push(spy);
    const result = await executeTool('get_todays_date', {});
    expect(JSON.parse(result)).toEqual({ date: '2025-06-01', day_of_week: 'Sunday' });
  });

  test('get_weather_forecast delegates with correct args', async () => {
    const spy = spyOn(weather, 'getWeatherForecast').mockResolvedValue({ daily: {} });
    spies.push(spy);
    await executeTool('get_weather_forecast', {
      latitude: 48.8566,
      longitude: 2.3522,
      start_date: '2025-06-01',
      end_date: '2025-06-03',
    });
    expect(weather.getWeatherForecast).toHaveBeenCalledWith(48.8566, 2.3522, '2025-06-01', '2025-06-03');
  });

  test('get_historical_weather delegates with correct args', async () => {
    const spy = spyOn(weather, 'getHistoricalWeather').mockResolvedValue({ daily: {} });
    spies.push(spy);
    await executeTool('get_historical_weather', {
      latitude: 48.8566,
      longitude: 2.3522,
      start_date: '2024-06-01',
      end_date: '2024-06-03',
    });
    expect(weather.getHistoricalWeather).toHaveBeenCalledWith(48.8566, 2.3522, '2024-06-01', '2024-06-03');
  });

  test('search_yelp delegates with correct args', async () => {
    const spy = spyOn(yelp, 'searchYelp').mockResolvedValue({ businesses: [] });
    spies.push(spy);
    await executeTool('search_yelp', { term: 'museums', location: 'Paris', limit: 10 });
    expect(yelp.searchYelp).toHaveBeenCalledWith('museums', 'Paris', 10);
  });

  test('create_notion_trip_plan_template delegates with correct args', async () => {
    const spy = spyOn(notion, 'createNotionTripPlanTemplate').mockResolvedValue({
      trip_page_id: 'p',
      trip_schedule_database_id: 'd',
    });
    spies.push(spy);
    await executeTool('create_notion_trip_plan_template', {
      trip_page_title: 'Paris Trip',
      packing_list: ['Passport'],
    });
    expect(notion.createNotionTripPlanTemplate).toHaveBeenCalledWith('Paris Trip', ['Passport']);
  });

  test('add_weather_to_notion_database delegates with correct args', async () => {
    const spy = spyOn(notion, 'addWeatherToNotionDatabase').mockResolvedValue({ id: 'entry' });
    spies.push(spy);
    await executeTool('add_weather_to_notion_database', {
      trip_schedule_database_id: 'db-id',
      day_of_week: 'Monday',
      trip_date: '2025-06-02',
      weather_summary: 'Sunny 72°F',
      activities_planned: 'Eiffel Tower',
      dining_plan: 'Café de Flore',
    });
    expect(notion.addWeatherToNotionDatabase).toHaveBeenCalledWith(
      'db-id', 'Monday', '2025-06-02', 'Sunny 72°F', 'Eiffel Tower', 'Café de Flore',
    );
  });

  test('unknown tool name returns error JSON', async () => {
    const result = await executeTool('nonexistent_tool', {});
    expect(JSON.parse(result)).toEqual({ error: 'Unknown tool: nonexistent_tool' });
  });
});
