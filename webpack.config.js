const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { execSync } = require('child_process');

let gitHash = 'dev';
try { gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* no git */ }
const BUILD = `${gitHash}-${Date.now().toString(36)}`;

module.exports = {
  entry: './src/client/game.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'public'),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/client/assets', to: 'assets', noErrorOnMissing: true },
        {
          from: 'src/client/index.html', to: 'index.html',
          // Version-stamp the bundle URL so browsers never keep a stale build
          transform: (content) => content.toString().replace('src="bundle.js"', `src="bundle.js?v=${BUILD}"`),
        },
      ],
    }),
    new webpack.DefinePlugin({ __BUILD__: JSON.stringify(BUILD) }),
  ],
  devtool: 'source-map',
}; 