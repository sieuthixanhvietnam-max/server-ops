import { BulbFilled, BulbOutlined } from '@ant-design/icons';
import { useAntdConfigSetter } from '@umijs/max';
import { Button, theme as antdTheme } from 'antd';
import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

const STORAGE_KEY = 'theme';

type Props = {
  setInitialState: (updater: (prev: any) => any) => void;
};

/** Switches both the page content (antd ConfigProvider algorithm, via
 * useAntdConfigSetter - covers tables/forms/cards) and the ProLayout chrome
 * (sidebar/header, via settings.navTheme) together, so light/dark stays
 * consistent across the whole app rather than just the nav. Persisted in
 * localStorage and re-applied on the next load - a brief flash of the
 * default light theme before that effect runs is an accepted trade-off
 * over a synchronous pre-hydration script. */
const ThemeToggle: React.FC<Props> = ({ setInitialState }) => {
  const setAntdConfig = useAntdConfigSetter();
  const [isDark, setIsDark] = useState(false);

  const applyTheme = (dark: boolean) => {
    setAntdConfig({
      theme: { algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm },
    });
    setInitialState((prev) => ({
      ...prev,
      settings: { ...prev?.settings, navTheme: dark ? 'realDark' : 'light' },
    }));
    setIsDark(dark);
  };

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === 'dark') applyTheme(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const next = !isDark;
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');

    // A plain CSS `transition` on color/background (tried previously) puts
    // a transition on every affected DOM node - antd's own maintainers
    // confirmed they don't support/recommend this for exactly that reason
    // (ant-design/ant-design#51317: "we will not provide this feature...
    // apply transition: none to all elements" before switching) - setting
    // up that many transitions at the same moment the whole token-driven
    // tree re-renders is what caused the white stall. The View Transitions
    // API sidesteps it entirely: the browser cross-fades ONE full-page
    // screenshot on the compositor/GPU instead of animating thousands of
    // individual elements, so it can't block the main thread the same way.
    // flushSync forces the state update to commit before the "after"
    // snapshot is taken - without it the transition can capture stale
    // (pre-toggle) colors. Falls back to an instant switch (this app's
    // original behavior) on browsers without support (Firefox, old Safari).
    if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(() => flushSync(() => applyTheme(next)));
    } else {
      applyTheme(next);
    }
  };

  return (
    <Button
      type="text"
      icon={isDark ? <BulbFilled /> : <BulbOutlined />}
      onClick={toggle}
      title={isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
    />
  );
};

export default ThemeToggle;
