const geocodingCache = new Map();
const CACHE_DURATION_MS = 10 * 60 * 1000;

export function normalizeCity(value) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('Provide a city name.'), { status: 400 });
  }

  const city = value.trim().replace(/\s+/g, ' ');
  if (city.length < 2 || city.length > 100) {
    throw Object.assign(new Error('City name must be between 2 and 100 characters.'), {
      status: 400,
    });
  }

  return city;
}

export function describeWeatherCode(code) {
  if ([0].includes(code)) return { condition: 'Clear sky', icon: 'clear' };
  if ([1, 2, 3].includes(code)) return { condition: 'Partly cloudy', icon: 'cloud' };
  if ([45, 48].includes(code)) return { condition: 'Foggy', icon: 'fog' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { condition: 'Rain showers', icon: 'rain' };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { condition: 'Snowfall', icon: 'snow' };
  }
  if ([95, 96, 99].includes(code)) return { condition: 'Thunderstorm', icon: 'storm' };
  return { condition: 'Variable conditions', icon: 'cloud' };
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw Object.assign(new Error('Weather service is temporarily unavailable.'), {
      status: 502,
      cause: error,
    });
  }

  if (!response.ok) {
    throw Object.assign(new Error('Weather service returned an error.'), { status: 502 });
  }

  const result = await response.json();
  if (result.error) {
    throw Object.assign(new Error('Weather service could not process this location.'), {
      status: 502,
    });
  }
  return result;
}

export async function findLocation(cityInput) {
  const city = normalizeCity(cityInput);
  const key = city.toLocaleLowerCase();
  const cached = geocodingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.location;

  const query = new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' });
  const result = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${query}`);
  const place = result.results?.[0];
  if (!place) {
    throw Object.assign(new Error(`No matching city was found for "${city}".`), { status: 404 });
  }

  const location = {
    name: place.name,
    region: place.admin1 || '',
    country: place.country || '',
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone || 'auto',
  };
  geocodingCache.set(key, { location, expiresAt: Date.now() + CACHE_DURATION_MS });
  return location;
}

export async function getCurrentWeather(location) {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'is_day',
      'precipitation',
      'weather_code',
      'pressure_msl',
      'wind_speed_10m',
      'wind_direction_10m',
    ].join(','),
    timezone: location.timezone,
  });
  const result = await fetchJson(`https://api.open-meteo.com/v1/forecast?${query}`);
  return {
    ...result.current,
    ...describeWeatherCode(result.current.weather_code),
    units: result.current_units,
  };
}

export async function getForecast(location) {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
    forecast_days: '7',
    timezone: location.timezone,
  });
  const result = await fetchJson(`https://api.open-meteo.com/v1/forecast?${query}`);

  const hourly = result.hourly.time.map((time, index) => ({
    time,
    temperature: result.hourly.temperature_2m[index],
    precipitationProbability: result.hourly.precipitation_probability[index],
    ...describeWeatherCode(result.hourly.weather_code[index]),
  }));
  const daily = result.daily.time.map((date, index) => ({
    date,
    high: result.daily.temperature_2m_max[index],
    low: result.daily.temperature_2m_min[index],
    precipitationProbability: result.daily.precipitation_probability_max[index],
    sunrise: result.daily.sunrise[index],
    sunset: result.daily.sunset[index],
    ...describeWeatherCode(result.daily.weather_code[index]),
  }));

  return {
    hourly,
    daily,
    units: { temperature: result.hourly_units.temperature_2m },
  };
}
