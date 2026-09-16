import { getMessageApi } from '@/utils/messageBridge';
import type { RequestConfig } from '@umijs/max';

// FastAPI's `detail` is usually a plain string (our own HTTPException calls),
// but on a 422 it's the auto-generated validation-error shape instead - an
// array of {loc, msg, type} objects. Naively doing String(detail) on that
// array stringifies each object via its default toString(), producing the
// literal text "[object Object]" instead of anything useful. Handle both
// shapes, plus a JSON fallback for anything else unexpected.
const formatErrorDetail = (detail: unknown): string => {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as any).msg) : String(d)));
    return msgs.join('; ');
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
};

// The backend (FastAPI) signals failures via HTTP status (raises
// HTTPException -> non-2xx), never via a `{success: false, errorCode, ...}`
// body on a 200 response - so only the axios-level error branches below
// (error.response / error.request / generic) are ever reached in practice.
//
// This handler runs outside any component (it's plain request-config code),
// so it can't call App.useApp() directly - it goes through messageBridge
// instead, which hands off the theme-aware instance from <MessageBridge/>.
export const errorConfig: RequestConfig = {
  errorConfig: {
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;
      const message = getMessageApi();
      if (error.response) {
        // Request reached the server, which responded with a non-2xx status.
        const detail = error.response.data?.detail;
        message.error(formatErrorDetail(detail) || `Lỗi ${error.response.status}`);
      } else if (error.request) {
        // Request was sent but no response came back (network/timeout).
        message.error('Không nhận được phản hồi từ server - vui lòng thử lại.');
      } else {
        message.error('Không gửi được yêu cầu - vui lòng thử lại.');
      }
    },
  },
};
