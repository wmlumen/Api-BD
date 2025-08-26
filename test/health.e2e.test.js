import request from 'supertest';
import createApp from '../src/app.js';

const app = createApp();

describe('Health and Docs endpoints', () => {
  it('GET /health should return ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /api-docs should be reachable (HTML)', async () => {
    const res = await request(app).get('/api-docs');
    expect([200, 301, 302]).toContain(res.status);
  });
});
