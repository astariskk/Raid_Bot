// bootstrap/webServer.js
import express from 'express';

export function startHealthServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get('/', (req, res) => {
    console.log('Health check endpoint (/) hit.');
    res.send('Bot is alive!');
  });

  app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
  });
}

