import { message as staticMessage } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

// Non-component code (request error interceptor, clipboard helper) can't
// call the App.useApp() hook, so it has no direct way to reach the
// theme-aware message instance - only <MessageBridge/> (mounted once inside
// the app's own <App> context, see components/MessageBridge) can. This is
// the hand-off point: the bridge writes its instance here on mount, and
// everything else reads through getMessageApi().
let instance: MessageInstance | undefined;

export const setMessageApi = (api: MessageInstance) => {
  instance = api;
};

/** Falls back to the static antd `message` (still functional, just not
 * theme-aware) on the off chance this runs before <MessageBridge/> has
 * mounted - e.g. a request fired during the very first paint. */
export const getMessageApi = (): MessageInstance => {
  if (instance) return instance;
  // eslint-disable-next-line no-console
  console.warn('[messageBridge] App context not mounted yet - falling back to static message');
  return staticMessage;
};
