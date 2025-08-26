import createApp from '../src/app.js';

// Export the Express app as the default export for Vercel serverless
const app = createApp();
export default app;
