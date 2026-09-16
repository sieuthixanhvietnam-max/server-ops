// https://umijs.org/config/

import { join } from 'node:path';
import { defineConfig } from '@umijs/max';
import defaultSettings from './defaultSettings';
import proxy from './proxy';

import routes from './routes';

const { REACT_APP_ENV = 'dev' } = process.env;

const PUBLIC_PATH: string = '/';

export default defineConfig({
  // Content-hashed build output, for cache-busting on deploy.
  hash: true,

  publicPath: PUBLIC_PATH,

  // umi routes: https://umijs.org/docs/routing
  routes,

  // https://umijs.org/docs/api/config#ignoremomentlocale
  ignoreMomentLocale: true,

  // Local dev proxy to the FastAPI backend - see config/proxy.ts.
  // Only active in dev; has no effect on the production build.
  proxy: proxy[REACT_APP_ENV as keyof typeof proxy],

  fastRefresh: true,

  //============== Umi Max plugin config ===============
  model: {},
  initialState: {},

  // https://umijs.org/docs/max/layout-menu
  title: 'Server Ops',
  layout: {
    locale: true,
    ...defaultSettings,
  },

  // Replaces moment with dayjs project-wide.
  moment2dayjs: {
    preset: 'antd',
    plugins: ['duration'],
  },

  locale: {
    default: 'vi-VN',
    antd: true,
    // No language switcher in this app (single Vietnamese-speaking team) -
    // always vi-VN regardless of each person's browser/OS language, rather
    // than silently rendering a different language for whoever's OS isn't
    // set to vi-VN.
    baseNavigator: false,
  },

  antd: {
    appConfig: {},
    configProvider: {
      theme: {
        cssVar: true,
        token: {
          fontFamily: 'AlibabaSans, sans-serif',
        },
      },
    },
  },

  request: {},
  access: {},

  headScripts: [
    // Avoids a blank white screen while the JS bundle loads.
    { src: join(PUBLIC_PATH, 'scripts/loading.js'), async: true },
  ],

  //================ Ant Design Pro preset =================
  presets: ['umi-presets-pro'],

  mock: {
    include: ['mock/**/*', 'src/pages/**/_mock.ts'],
  },

  // https://umijs.org/docs/api/config#mako
  mako: {},
  esbuildMinifyIIFE: true,
  requestRecord: {},
  exportStatic: {},
  define: {
    'process.env.CI': process.env.CI,
  },
  tailwindcss: {},
});
