import createApp from '../src/app.js';

// Export the Express app for Vercel serverless runtime
const app = createApp();
export default app;
