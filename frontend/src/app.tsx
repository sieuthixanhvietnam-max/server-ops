import { UserOutlined } from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { ProConfigProvider, SettingDrawer, enUSIntl, viVNIntl } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, useIntl } from '@umijs/max';
import React, { useState } from 'react';
import { AvatarDropdown, AvatarName, Footer, ThemeToggle } from '@/components';
import MessageBridge from '@/components/MessageBridge';
import { currentUser as queryCurrentUser, getToken } from '@/services/serverOps/auth';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';
import '@ant-design/v5-patch-for-react-19';

const isDev = process.env.NODE_ENV === 'development' || process.env.CI;
const loginPath = '/user/login';

// @ant-design/pro-provider's own vi_VN pack mistranslates pagination's
// "items" unit as "mặt hàng" (merchandise/goods) - wrong for an ops app
// with no products. Everything else in its bundle is fine, so intercept
// just that one message id and delegate the rest to the original lookup.
const viVNIntlPatched: typeof viVNIntl = {
  ...viVNIntl,
  getMessage: (id, defaultMessage) =>
    id === 'pagination.total.item' ? 'mục' : viVNIntl.getMessage(id, defaultMessage),
};

const PRO_INTL_BY_LOCALE: Record<string, typeof viVNIntl> = {
  'vi-VN': viVNIntlPatched,
  'en-US': enUSIntl,
};

const ProIntlProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { locale } = useIntl();
  return (
    <ProConfigProvider intl={PRO_INTL_BY_LOCALE[locale] || PRO_INTL_BY_LOCALE['vi-VN']}>
      {children}
    </ProConfigProvider>
  );
};

/**
 * @see https://umijs.org/docs/api/runtime-config#getinitialstate
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  loading?: boolean;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
}> {
  const fetchUserInfo = async () => {
    try {
      const msg = await queryCurrentUser({
        skipErrorHandler: true,
      });
      return msg.data;
    } catch (_error) {
      history.push(loginPath);
    }
    return undefined;
  };
  const { location } = history;
  if (location.pathname !== loginPath) {
    const currentUser = await fetchUserInfo();
    return {
      fetchUserInfo,
      currentUser,
      settings: defaultSettings as Partial<LayoutSettings>,
    };
  }
  return {
    fetchUserInfo,
    settings: defaultSettings as Partial<LayoutSettings>,
  };
}

// ProLayout runtime config: https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => {
  // Accordion sidebar: opening a group closes whichever other one was open,
  // instead of every group staying expanded independently (they could all
  // be open together before, growing into one long list of every item).
  // The open group always tracks the current page's own group too (same as
  // ProLayout's uncontrolled default) - deriveGroupKey('/data/domains') ->
  // '/data', matching the top-level route path in config/routes.ts.
  const deriveGroupKey = (pathname: string) => `/${pathname.split('/')[1] || ''}`;
  const [openKeys, setOpenKeys] = useState<string[]>(() => [deriveGroupKey(history.location.pathname)]);
  const handleOpenChange = (keys: string[]) => {
    const latestOpenKey = keys.find((key) => !openKeys.includes(key));
    setOpenKeys(latestOpenKey ? [latestOpenKey] : keys);
  };

  return {
    menu: { defaultOpenAll: false },
    // ProLayout's own top-level openKeys/handleOpenChange props only end up
    // controlling the initial render in this version - actual click events
    // only reach us through the antd Menu's own onOpenChange, forwarded via
    // menuProps (confirmed empirically: handleOpenChange above never fired
    // without this).
    menuProps: { openKeys, onOpenChange: handleOpenChange },
    avatarProps: {
      src: initialState?.currentUser?.avatar,
      // The backend has no avatar upload feature, so currentUser.avatar is
      // always empty - ProLayout only renders an Avatar element at all when
      // src/icon/children is truthy (see ActionsContent.js), so without
      // this fallback icon the avatar area shows just the name text, no
      // circle/icon next to it.
      icon: <UserOutlined />,
      title: <AvatarName />,
      render: (_, avatarChildren) => {
        return <AvatarDropdown>{avatarChildren}</AvatarDropdown>;
      },
    },
    waterMarkProps: {
      content: initialState?.currentUser?.name,
    },
    footerRender: () => <Footer />,
    onPageChange: () => {
      const { location } = history;
      if (!initialState?.currentUser && location.pathname !== loginPath) {
        history.push(loginPath);
      }
      setOpenKeys([deriveGroupKey(location.pathname)]);
    },
    actionsRender: () => [<ThemeToggle key="theme" setInitialState={setInitialState} />],
    links: [],
    menuHeaderRender: undefined,
    childrenRender: (children) => {
      return (
        <ProIntlProvider>
          <MessageBridge />
          {children}
          {isDev && (
            <SettingDrawer
              disableUrlParams
              enableDarkTheme
              settings={initialState?.settings}
              onSettingChange={(settings) => {
                setInitialState((preInitialState) => ({
                  ...preInitialState,
                  settings,
                }));
              }}
            />
          )}
        </ProIntlProvider>
      );
    },
    ...initialState?.settings,
  };
};

export const request: RequestConfig = {
  ...errorConfig,
  requestInterceptors: [
    (config: any) => {
      const token = getToken();
      if (token) {
        config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
      }
      return config;
    },
  ],
};
