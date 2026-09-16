/**
 * Local dev proxy: forwards /api/** to the FastAPI backend. Has no effect
 * on the production build - see config/config.ts's `proxy` key, only
 * applied when running `umi dev`.
 * @doc https://umijs.org/docs/guides/proxy
 */
export default {
  dev: {
    '/api/': {
      target: 'http://localhost:8010',
      changeOrigin: true,
      pathRewrite: { '^': '' },
    },
  },
};
