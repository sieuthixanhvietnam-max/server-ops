import { setMessageApi } from '@/utils/messageBridge';
import { App } from 'antd';
import { useEffect } from 'react';

/** Mounted once near the app root (see app.tsx childrenRender) purely to
 * hand the theme-aware message instance from App.useApp() off to
 * messageBridge, so non-component code (request error interceptor,
 * clipboard helper) can show messages without triggering antd's "Static
 * function can not consume context" warning. Renders nothing. */
const MessageBridge: React.FC = () => {
  const { message } = App.useApp();
  useEffect(() => {
    setMessageApi(message);
  }, [message]);
  return null;
};

export default MessageBridge;
