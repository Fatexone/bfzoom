// server/config/pm2.config.cjs
const pm2Config = {
  apps: [
    {
      name: "bfzoom-socket",
      script: "./server/socket/index.js",
      node_args: "--env-file=server/.env",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 4001,
      },
    },
  ],
};

module.exports = pm2Config;
