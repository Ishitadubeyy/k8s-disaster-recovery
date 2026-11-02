import express from 'express';
import { pool, waitForDatabase } from './db.js';
import {
  findLocation,
  getCurrentWeather,
  getForecast,
  normalizeCity,
} from './weather.js';

const app = express();
const port = Number(process.env.PORT || 3001);

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.get('/live', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/weather', async (request, response, next) => {
  try {
    const city = normalizeCity(request.query.city);
    const location = await findLocation(city);
    const current = await getCurrentWeather(location);
    await pool.query('INSERT INTO search_history (city) VALUES ($1)', [location.name]);
    response.json({
      location,
      current,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/forecast', async (request, response, next) => {
  try {
    const location = await findLocation(request.query.city);
    const forecast = await getForecast(location);
    response.json({ location, ...forecast });
  } catch (error) {
    next(error);
  }
});

app.get('/api/favorites', async (_request, response, next) => {
  try {
    const result = await pool.query(
      'SELECT id, city, created_at AS "createdAt" FROM favorites ORDER BY city_key',
    );
    response.json({ favorites: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/favorites', async (request, response, next) => {
  try {
    const city = normalizeCity(request.body?.city);
    const cityKey = city.toLocaleLowerCase();
    const result = await pool.query(
      `INSERT INTO favorites (city, city_key)
       VALUES ($1, $2)
       ON CONFLICT (city_key) DO UPDATE SET city = EXCLUDED.city
       RETURNING id, city, created_at AS "createdAt"`,
      [city, cityKey],
    );
    response.status(201).json({ favorite: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/favorites/:id', async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(400).json({ error: 'Favorite id must be a positive integer.' });
    return;
  }

  try {
    const result = await pool.query('DELETE FROM favorites WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Favorite city was not found.' });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/history', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, city, searched_at AS "searchedAt"
       FROM search_history
       ORDER BY searched_at DESC, id DESC
       LIMIT 10`,
    );
    response.json({ history: result.rows });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint was not found.' });
});

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  response.status(status).json({
    error: status === 500 ? 'The server could not complete the request.' : error.message,
  });
});

async function start() {
  await waitForDatabase();
  const server = app.listen(port, '0.0.0.0', () => {
    console.info(`WeatherWatch API listening on port ${port}.`);
  });

  const shutdown = () => {
    server.close(() => {
      pool.end().then(() => process.exit(0)).catch((error) => {
        console.error('Database pool shutdown failed.', error);
        process.exit(1);
      });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('WeatherWatch API failed to start.', error);
  process.exit(1);
});
