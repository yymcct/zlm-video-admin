const {defineConfig} = require("@vue/cli-service");

const isZlmHttps = process.env.VUE_APP_ZLMEDIAKIT_IS_SSL === 'true';
const zlmServiceHost = process.env.VUE_APP_ZLMEDIAKIT_SERVICE_IP || '127.0.0.1';
const zlmHttpPort = process.env.VUE_APP_ZLMEDIAKIT_HTTP_PORT ? `:${process.env.VUE_APP_ZLMEDIAKIT_HTTP_PORT}` : '';
const zlmProxyTarget = `${isZlmHttps ? 'https' : 'http'}://${zlmServiceHost}${zlmHttpPort}`;

module.exports = defineConfig({
  transpileDependencies: true,
  publicPath: process.env.NODE_ENV === "production" ? "./" : "/",
  configureWebpack: {
    resolve: {
      fallback: {
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer/')
      }
    }
  },
  // 配置 devServer
  devServer: {
    host: "0.0.0.0",
    port: 8989,
    open: false,
    client: {
      overlay: false,
    },
    proxy: {
      "/zlm": {
        target: zlmProxyTarget,
        changeOrigin: true,
        secure: false,
        logLevel: 'debug',
        pathRewrite: {
          "^/zlm": "", // 重写请求路径别名
        }
      },
    },
  },
});
