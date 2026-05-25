// PM2 process configuration for Zuka API
// Usage: pm2 start ecosystem.config.cjs --only zuka-api-prod
//        pm2 start ecosystem.config.cjs --only zuka-api-staging
//        pm2 start ecosystem.config.cjs                 (both)

module.exports = {
  apps: [
    {
      name: "zuka-api-prod",
      script: "dist/index.js",
      cwd: "/home/deploy/zuka-api",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3456,
      },
      env_file: ".env",
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      max_memory_restart: "450M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/deploy/.pm2/logs/zuka-api-prod-error.log",
      out_file: "/home/deploy/.pm2/logs/zuka-api-prod-out.log",
      merge_logs: true,
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
    {
      name: "zuka-api-staging",
      script: "dist/index.js",
      cwd: "/home/deploy/zuka-api-staging",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "staging",
        PORT: 3457,
      },
      env_file: ".env",
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/home/deploy/.pm2/logs/zuka-api-staging-error.log",
      out_file: "/home/deploy/.pm2/logs/zuka-api-staging-out.log",
      merge_logs: true,
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};
