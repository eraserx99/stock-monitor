module.exports = {
  apps: [
    {
      name: 'stock-monitor',
      script: 'src/index.js',
      interpreter: 'node',
    },
    {
      name: 'stock-web',
      script: 'src/server.js',
      interpreter: 'node',
    },
  ],
};
