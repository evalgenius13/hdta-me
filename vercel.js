{
  "functions": {
    "api/cron/automated-daily.js": {
      "maxDuration": 300
    }
  },
  "crons": [
    {
      "path": "/api/cron/automated-daily",
      "schedule": "0 10 * * *"
    }
  ]
}
