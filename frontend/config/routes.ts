/**
 * @doc https://umijs.org/docs/guides/routes
 */
export default [
  {
    path: '/user',
    layout: false,
    routes: [
      {
        path: '/user/login',
        layout: false,
        name: 'login',
        component: './user/login',
      },
      {
        path: '/user',
        redirect: '/user/login',
      },
      {
        component: '404',
        path: '/user/*',
      },
    ],
  },
  {
    name: 'dashboard',
    icon: 'dashboard',
    path: '/dashboard',
    component: './dashboard',
  },
  {
    path: '/data',
    name: 'data',
    icon: 'database',
    routes: [
      {
        path: '/data',
        redirect: '/data/domains',
      },
      {
        name: 'domains',
        icon: 'global',
        path: '/data/domains',
        component: './domains',
      },
      {
        name: 'servers',
        icon: 'cloudServer',
        path: '/data/servers',
        component: './servers',
      },
      {
        name: 'pics',
        icon: 'team',
        path: '/data/pics',
        component: './pics',
      },
      {
        name: 'cf-accounts',
        icon: 'idcard',
        path: '/data/cf-accounts',
        component: './cf-accounts',
      },
      {
        name: 'cf-domains',
        icon: 'cloud',
        path: '/data/cf-domains',
        component: './cf-domains',
      },
      {
        name: 'cf-whitelist',
        icon: 'safetyCertificate',
        path: '/data/cf-whitelist',
        component: './cf-whitelist',
      },
    ],
  },
  {
    path: '/monitor',
    name: 'monitor',
    icon: 'eye',
    routes: [
      {
        path: '/monitor',
        redirect: '/monitor/job-history',
      },
      {
        name: 'job-history',
        icon: 'fieldTime',
        path: '/monitor/job-history',
        component: './job-history',
      },
      {
        name: 'domain-changes',
        icon: 'history',
        path: '/monitor/domain-changes',
        component: './domain-changes',
      },
      {
        name: 'access-control',
        icon: 'lock',
        path: '/monitor/access-control',
        component: './access-control',
      },
      {
        name: 'redirect-report',
        icon: 'barChart',
        path: '/monitor/redirect-report',
        component: './redirect-report',
      },
    ],
  },
  {
    path: '/server-task',
    name: 'server-task',
    icon: 'rocket',
    routes: [
      {
        path: '/server-task',
        redirect: '/server-task/clone-wpsite',
      },
      {
        name: 'clone-wpsite',
        icon: 'copy',
        path: '/server-task/clone-wpsite',
        component: './ops/clone-wpsite',
      },
      {
        name: 'migrate-wpsite',
        icon: 'swap',
        path: '/server-task/migrate-wpsite',
        component: './ops/migrate-wpsite',
      },
      {
        name: 'create-wpsite',
        icon: 'plusCircle',
        path: '/server-task/create-wpsite',
        component: './ops/create-wpsite',
      },
      {
        name: 'plugin-manager',
        icon: 'appstore',
        path: '/server-task/plugin-manager',
        component: './ops/plugin-manager',
      },
      {
        name: 'wp-maintenance',
        icon: 'tool',
        path: '/server-task/wp-maintenance',
        component: './ops/wp-maintenance',
      },
      {
        name: 'check-health',
        icon: 'heart',
        path: '/server-task/check-health',
        component: './ops/check-health',
      },
      {
        name: 'change-wppass',
        icon: 'key',
        path: '/server-task/change-wppass',
        component: './ops/change-wppass',
      },
      {
        name: 'restore-wpsite',
        icon: 'undo',
        path: '/server-task/restore-wpsite',
        component: './ops/restore-wpsite',
      },
      {
        name: 'remove-wpsite',
        icon: 'delete',
        path: '/server-task/remove-wpsite',
        component: './ops/remove-wpsite',
      },
    ],
  },
  {
    path: '/cf-task',
    name: 'cf-task',
    icon: 'cloud',
    routes: [
      {
        path: '/cf-task',
        redirect: '/cf-task/cf-add',
      },
      {
        name: 'cf-add',
        icon: 'plus',
        path: '/cf-task/cf-add',
        component: './ops/cf-add',
      },
      {
        name: 'zone-tools',
        icon: 'thunderbolt',
        path: '/cf-task/zone-tools',
        component: './ops/zone-tools',
      },
      {
        name: 'cf-redirect',
        icon: 'swap',
        path: '/cf-task/cf-redirect',
        component: './ops/cf-redirect',
      },
      {
        name: 'cf-redirect-audit',
        icon: 'search',
        path: '/cf-task/cf-redirect-audit',
        component: './ops/cf-redirect-audit',
      },
      {
        name: 'force-index',
        icon: 'rise',
        path: '/cf-task/force-index',
        component: './ops/force-index',
      },
      {
        name: 'cf-redirect-remove',
        icon: 'delete',
        path: '/cf-task/cf-redirect-remove',
        component: './ops/cf-redirect-remove',
      },
      {
        name: 'cf-remove',
        icon: 'delete',
        path: '/cf-task/cf-remove',
        component: './ops/cf-remove',
      },
      {
        name: 'cf-firewall',
        icon: 'fire',
        path: '/cf-task/cf-firewall',
        component: './ops/cf-firewall',
      },
    ],
  },
  {
    name: 'docs',
    icon: 'book',
    path: '/docs',
    component: './docs',
  },
  {
    name: 'settings',
    icon: 'setting',
    path: '/settings',
    component: './settings',
  },
  {
    name: 'changelog',
    icon: 'history',
    path: '/changelog',
    component: './changelog',
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    component: '404',
    path: './*',
  },
];
