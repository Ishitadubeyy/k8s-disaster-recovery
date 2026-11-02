import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = '/api';

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function WeatherIcon({ type = 'cloud', className = '' }) {
  const cloud = <path d="M18 18H8a5 5 0 0 1-.7-9.95A7 7 0 0 1 21 9a4.5 4.5 0 0 1-3 9Z" />;
  let shape = cloud;
  if (type === 'clear') {
    shape = <><circle cx="12" cy="12" r="4.3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>;
  } else if (type === 'rain') {
    shape = <><path d="M18 14H8a5 5 0 0 1-.7-9.95A7 7 0 0 1 21 5a4.5 4.5 0 0 1-3 9Z" /><path d="m9 17-1 3m6-3-1 3m6-3-1 3" /></>;
  } else if (type === 'snow') {
    shape = <><path d="M18 13H8a5 5 0 0 1-.7-9.95A7 7 0 0 1 21 4a4.5 4.5 0 0 1-3 9Z" /><path d="M9 17v4m-2-2h4m5-2v4m-2-2h4" /></>;
  } else if (type === 'storm') {
    shape = <><path d="M18 13H8a5 5 0 0 1-.7-9.95A7 7 0 0 1 21 4a4.5 4.5 0 0 1-3 9Z" /><path d="m13 14-3 5h3l-1 4 4-6h-3l1-3" /></>;
  } else if (type === 'fog') {
    shape = <><path d="M18 12H8a5 5 0 0 1-.7-9.95A7 7 0 0 1 21 3a4.5 4.5 0 0 1-3 9Z" /><path d="M4 16h15M6 20h12" /></>;
  }
  return (
    <svg className={`weather-icon ${className}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {shape}
    </svg>
  );
}

function formatHour(value) {
  const [hour, minute] = value.slice(11, 16).split(':').map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

function formatDay(value, options = { weekday: 'short' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${value}T12:00:00`));
}

function App() {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [error, setError] = useState('');

  const loadCollections = useCallback(async () => {
    const [favoriteData, historyData] = await Promise.all([
      request('/favorites'),
      request('/history'),
    ]);
    setFavorites(favoriteData.favorites);
    setHistory(historyData.history);
  }, []);

  const loadCity = useCallback(async (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a city name to see its weather.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [weatherData, forecastData] = await Promise.all([
        request(`/weather?city=${encodeURIComponent(trimmed)}`),
        request(`/forecast?city=${encodeURIComponent(trimmed)}`),
      ]);
      setWeather(weatherData);
      setForecast(forecastData);
      setCity(weatherData.location.name);
      setQuery('');
      await loadCollections();
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [loadCollections]);

  useEffect(() => {
    Promise.all([loadCity('Mumbai'), loadCollections()]).catch((loadError) => {
      setError(loadError.message);
      setLoading(false);
    });
  }, [loadCity, loadCollections]);

  const todayHours = useMemo(() => {
    if (!forecast?.hourly) return [];
    const nowParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: forecast.location.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date()).reduce((parts, part) => {
      parts[part.type] = part.value;
      return parts;
    }, {});
    const currentHour = `${nowParts.year}-${nowParts.month}-${nowParts.day}T${nowParts.hour}:00`;
    const upcoming = forecast.hourly.filter((hour) => hour.time >= currentHour);
    return (upcoming.length ? upcoming : forecast.hourly).slice(0, 12);
  }, [forecast]);

  const isFavorite = favorites.some((favorite) =>
    favorite.city.toLocaleLowerCase() === city.toLocaleLowerCase());

  async function toggleFavorite() {
    setSavingFavorite(true);
    setError('');
    try {
      if (isFavorite) {
        const favorite = favorites.find((item) =>
          item.city.toLocaleLowerCase() === city.toLocaleLowerCase());
        await request(`/favorites/${favorite.id}`, { method: 'DELETE' });
        setFavorites((items) => items.filter((item) => item.id !== favorite.id));
      } else {
        const result = await request('/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ city }),
        });
        setFavorites((items) => [...items.filter((item) => item.id !== result.favorite.id), result.favorite]);
      }
    } catch (favoriteError) {
      setError(favoriteError.message);
    } finally {
      setSavingFavorite(false);
    }
  }

  const placeLabel = weather
    ? [weather.location.region, weather.location.country].filter(Boolean).join(', ')
    : '';
  const current = weather?.current;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="WeatherWatch home">
          <span className="brand-mark"><WeatherIcon type="clear" /></span>
          <span>weather<span className="brand-accent">watch</span></span>
        </a>
        <div className="topbar-note"><span className="live-dot" /> LIVE WEATHER</div>
      </header>

      <main className="dashboard">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">YOUR WEATHER, AT A GLANCE</p>
            <h1>Good day, wherever you are.</h1>
          </div>
          <form className="search-form" onSubmit={(event) => {
            event.preventDefault();
            loadCity(query);
          }}>
            <span className="search-symbol" aria-hidden="true">⌕</span>
            <input aria-label="Search a city" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search any city..." />
            <button type="submit" disabled={loading}>Search</button>
          </form>
        </section>

        {error && <div className="error-banner" role="alert">
          <span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>}

        {loading && !weather ? (
          <div className="loading-panel" role="status"><span className="spinner" /> Finding your forecast…</div>
        ) : (
          <>
            <section className={`hero-card ${loading ? 'is-refreshing' : ''}`} aria-label="Current weather">
              <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
              <div className="hero-content">
                <div className="hero-location">
                  <div>
                    <p className="hero-kicker">CURRENT WEATHER</p>
                    <h2>{weather?.location.name || 'Search a city'}</h2>
                    <p className="location-detail">{placeLabel}</p>
                  </div>
                  {weather && <button className={`favorite-toggle ${isFavorite ? 'selected' : ''}`}
                    onClick={toggleFavorite} disabled={savingFavorite}
                    aria-label={isFavorite ? 'Remove favorite' : 'Add to favorites'}>
                    {isFavorite ? '★' : '☆'} <span>{isFavorite ? 'Saved' : 'Save city'}</span>
                  </button>}
                </div>
                {current ? (
                  <div className="temperature-row">
                    <WeatherIcon type={current.icon} className="hero-weather-icon" />
                    <div className="temperature">{Math.round(current.temperature_2m)}<span>°</span></div>
                    <div className="condition-block">
                      <strong>{current.condition}</strong>
                      <span>Feels like {Math.round(current.apparent_temperature)}°</span>
                      <span>H:{forecast?.daily?.[0]?.high ?? '—'}° &nbsp; L:{forecast?.daily?.[0]?.low ?? '—'}°</span>
                    </div>
                  </div>
                ) : <p className="empty-weather">Search a city to see live conditions.</p>}
                {current && <div className="hero-footer">
                  <span><span className="sunrise-symbol">◷</span> {formatDay(new Date().toISOString().slice(0, 10), { month: 'long', day: 'numeric' })}</span>
                  <span>Updated {new Date(weather.fetchedAt).toLocaleTimeString([], {
                    hour: 'numeric', minute: '2-digit', timeZone: weather.location.timezone,
                  })}</span>
                </div>}
              </div>
            </section>

            <section className="metrics-grid" aria-label="Weather details">
              <Metric label="HUMIDITY" value={current ? `${current.relative_humidity_2m}%` : '—'}
                note="Relative humidity" symbol="◌" />
              <Metric label="WIND SPEED" value={current ? `${current.wind_speed_10m} km/h` : '—'}
                note="Wind at 10 m" symbol="↗" />
              <Metric label="PRESSURE" value={current ? `${Math.round(current.pressure_msl)} hPa` : '—'}
                note="Sea-level pressure" symbol="⌁" />
              <Metric label="PRECIPITATION" value={current ? `${current.precipitation} mm` : '—'}
                note="Current amount" symbol="⌄" />
            </section>

            <section className="content-grid">
              <div className="forecast-panel panel">
                <div className="section-heading">
                  <div><p className="eyebrow">THE NEXT 12 HOURS</p><h3>Hourly forecast</h3></div>
                  <span className="section-icon">◷</span>
                </div>
                <div className="hourly-list">
                  {todayHours.map((hour) => (
                    <div className="hour-card" key={hour.time}>
                      <span className="hour-label">{formatHour(hour.time)}</span>
                      <WeatherIcon type={hour.icon} className="hour-icon" />
                      <strong>{Math.round(hour.temperature)}°</strong>
                      <span className="rain-chance">☂ {hour.precipitationProbability ?? 0}%</span>
                    </div>
                  ))}
                  {!forecast && <ForecastPlaceholder />}
                </div>
              </div>

              <aside className="side-panel">
                <section className="panel city-panel">
                  <div className="section-heading compact-heading">
                    <div><p className="eyebrow">YOUR PLACES</p><h3>Favorite cities</h3></div>
                    <span className="section-icon">☆</span>
                  </div>
                  <div className="city-list">
                    {favorites.map((favorite) => (
                      <div className={`city-row ${favorite.city === city ? 'active' : ''}`} key={favorite.id}>
                        <button className="city-select" onClick={() => loadCity(favorite.city)}>
                          <span className="city-pin">⌖</span><span>{favorite.city}</span>
                        </button>
                        <button className="remove-city" aria-label={`Remove ${favorite.city}`}
                          onClick={async () => {
                            try {
                              await request(`/favorites/${favorite.id}`, { method: 'DELETE' });
                              setFavorites((items) => items.filter((item) => item.id !== favorite.id));
                            } catch (removeError) { setError(removeError.message); }
                          }}>×</button>
                      </div>
                    ))}
                    {favorites.length === 0 && <p className="muted-copy">Save a city to keep it close.</p>}
                  </div>
                </section>
                <section className="panel recent-panel">
                  <div className="section-heading compact-heading">
                    <div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h3>Recent searches</h3></div>
                    <span className="section-icon">↺</span>
                  </div>
                  <div className="recent-list">
                    {history.slice(0, 5).map((item) => (
                      <button className="recent-city" key={item.id} onClick={() => loadCity(item.city)}>
                        <span>{item.city}</span><span>↗</span>
                      </button>
                    ))}
                    {history.length === 0 && <p className="muted-copy">Your recent searches will appear here.</p>}
                  </div>
                </section>
              </aside>
            </section>

            <section className="panel weekly-panel">
              <div className="section-heading">
                <div><p className="eyebrow">PLAN AHEAD</p><h3>7-day forecast</h3></div>
                <span className="forecast-location">{weather?.location.name || ''}</span>
              </div>
              <div className="weekly-list">
                {forecast?.daily.map((day, index) => (
                  <div className="day-row" key={day.date}>
                    <strong>{index === 0 ? 'Today' : formatDay(day.date)}</strong>
                    <div className="day-condition"><WeatherIcon type={day.icon} className="day-icon" />
                      <span>{day.condition}</span></div>
                    <span className="day-rain">☂ {day.precipitationProbability ?? 0}%</span>
                    <span className="day-low">{Math.round(day.low)}°</span>
                    <span className="day-high">{Math.round(day.high)}°</span>
                    <div className="temperature-track"><span style={{ left: `${Math.min(75, Math.max(5, (day.low + 5) * 2))}%`,
                      width: `${Math.min(75, Math.max(15, (day.high - day.low) * 2))}%` }} /></div>
                  </div>
                ))}
                {!forecast && <ForecastPlaceholder />}
              </div>
            </section>
          </>
        )}
        <footer className="page-footer">
          <span>WeatherWatch</span><span>Forecasts powered by Open-Meteo</span>
        </footer>
      </main>
    </div>
  );
}

function Metric({ label, value, note, symbol }) {
  return <article className="metric-card">
    <div className="metric-top"><span className="metric-icon">{symbol}</span><span>{label}</span></div>
    <strong>{value}</strong><span className="metric-note">{note}</span>
  </article>;
}

function ForecastPlaceholder() {
  return <div className="forecast-empty"><span className="spinner" /> Loading forecast…</div>;
}

export default App;
