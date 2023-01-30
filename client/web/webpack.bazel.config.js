// @ts-check

const path = require('path')

// const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin')
// const SentryWebpackPlugin = require('@sentry/webpack-plugin')
// const CompressionPlugin = require('compression-webpack-plugin')
// const CssMinimizerWebpackPlugin = require('css-minimizer-webpack-plugin')
// const mapValues = require('lodash/mapValues')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const webpack = require('webpack')
// const { WebpackManifestPlugin } = require('webpack-manifest-plugin')
// const { StatsWriterPlugin } = require('webpack-stats-plugin')

// const {
  // ROOT_PATH,
  // STATIC_ASSETS_PATH,
  // getCSSLoaders,
  // getTerserPlugin,
  // getProvidePlugin,
  // getCSSModulesLoader,
  // getMonacoCSSRule,
  // getMonacoTTFRule,
  // getBasicCSSLoader,
// } = require('@sourcegraph/build-config')

const { IS_PRODUCTION, IS_DEVELOPMENT, ENVIRONMENT_CONFIG } = require('./dev/utils')
// const { getHTMLWebpackPlugins } = require('./dev/webpack/get-html-webpack-plugins')

const {
  NODE_ENV,
  // CI: IS_CI,
  INTEGRATION_TESTS,
  ENABLE_SENTRY,
  ENABLE_OPEN_TELEMETRY,
  SOURCEGRAPH_API_URL,
  WEBPACK_SERVE_INDEX,
  COMMIT_SHA,
} = ENVIRONMENT_CONFIG

const RUNTIME_ENV_VARIABLES = {
  NODE_ENV,
  ENABLE_SENTRY,
  ENABLE_OPEN_TELEMETRY,
  INTEGRATION_TESTS,
  COMMIT_SHA,
  ...(WEBPACK_SERVE_INDEX && { SOURCEGRAPH_API_URL }),
}

const styleLoader = IS_DEVELOPMENT ? 'style-loader' : MiniCssExtractPlugin.loader

// Used to ensure that we include all initial chunks into the Webpack manifest.
const initialChunkNames = {
  react: 'react',
  opentelemetry: 'opentelemetry',
}

/** @type {import('webpack').Configuration} */
const config = {
  context: __dirname, // needed when running `gulp webpackDevServer` from the root dir
  mode: IS_PRODUCTION ? 'production' : 'development',
  stats: {
    // Minimize logging in case if Webpack is used along with multiple other services.
    // Use `normal` output preset in case of running standalone web server.
    preset: WEBPACK_SERVE_INDEX || IS_PRODUCTION ? 'normal' : 'errors-warnings',
    errorDetails: true,
    timings: true,
  },
  optimization: {
    minimize: IS_PRODUCTION,
    // minimizer: [getTerserPlugin(), new CssMinimizerWebpackPlugin()],
    // splitChunks: IS_DEVELOPMENT ? false : {
    //   cacheGroups: {
    //     [initialChunkNames.react]: {
    //       test: /(react|react-dom)[/\\]/,
    //       name: initialChunkNames.react,
    //       chunks: 'all',
    //     },
    //     [initialChunkNames.opentelemetry]: {
    //       test: /(@opentelemetry)[/\\]/,
    //       name: initialChunkNames.opentelemetry,
    //       chunks: 'all',
    //     },
    //   },
    // },
    removeEmptyChunks: IS_PRODUCTION,
    removeAvailableModules: IS_PRODUCTION,
    // Running multiple entries on a single page that do not share a runtime chunk from the same compilation is not supported.
    // https://github.com/webpack/webpack-dev-server/issues/2792#issuecomment-808328432
    // runtimeChunk: IS_PRODUCTION ? false : (isHotReloadEnabled ? 'single' : false)
  },
  output: {
    // path: STATIC_ASSETS_PATH,
    filename: 'scripts/[name].[contenthash].bundle.js',
    chunkFilename: 'scripts/[name]-[contenthash].chunk.js',
    publicPath: '/.assets/',
    globalObject: 'self',
    pathinfo: false,
  },
  devtool: 'source-map',
  plugins: [
    // Change scss imports to the pre-compiled css files
    new webpack.NormalModuleReplacementPlugin(
      /.*\.scss$/,
      resource => {
        resource.request = resource.request.replace(/\.scss$/, '.css')
      }
    ),

    // new webpack.DefinePlugin({
    //   'process.env': mapValues(RUNTIME_ENV_VARIABLES, JSON.stringify),
    // }),
    // new MiniCssExtractPlugin({
    //   // Do not [hash] for development -- see https://github.com/webpack/webpack-dev-server/issues/377#issuecomment-241258405
    //   filename:
    //     IS_PRODUCTION && !WEBPACK_USE_NAMED_CHUNKS
    //       ? 'styles/[name].[contenthash].bundle.css'
    //       : 'styles/[name].bundle.css',
    // }),
    // getProvidePlugin(),
  ],
  resolve: {
    extensions: ['.mjs', '.jsx', '.js', '.json'],
    mainFields: ['es2015', 'module', 'browser', 'main'],
    fallback: {
      path: require.resolve('path-browserify'),
      punycode: require.resolve('punycode'),
      util: require.resolve('util'),
    },
    alias: {
      // react-visibility-sensor's main field points to a UMD bundle instead of ESM
      // https://github.com/joshwnj/react-visibility-sensor/issues/148
      // 'react-visibility-sensor': path.resolve(ROOT_PATH, 'node_modules/react-visibility-sensor/visibility-sensor.js'),
    },
  },
  module: {
    rules: [
      // {
      //   test: /\.css$/,
      //   // CSS Modules loaders are only applied when the file is explicitly named as CSS module stylesheet using the extension `.module.scss`.
      //   include: /\.module\.css$/,
      //   use: getCSSLoaders(styleLoader, getCSSModulesLoader({ sourceMap: IS_DEVELOPMENT })),
      // },
      {
        test: /\.css$/,
        use: {
          loader: 'css-loader',
          options: { url: false },
        },
      },
      // getMonacoCSSRule(),
      // getMonacoTTFRule(),
      // { test: /\.ya?ml$/, type: 'asset/source' },
      // { test: /\.(png|woff2)$/, type: 'asset/resource' },
    ],
  },
}

module.exports = config
