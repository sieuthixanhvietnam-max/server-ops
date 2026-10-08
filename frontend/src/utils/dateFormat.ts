import dayjs from 'dayjs';

/** Canonical timestamp format used across the app (table cells, detail
 * panels, tooltips) - `giờ` trước, `ngày-tháng-năm` sau (VD: "07:35:45
 * 08-10-2026"), theo yêu cầu đổi thống nhất cấu trúc thời gian toàn hệ
 * thống. Trước đó là `YYYY-MM-DD HH:mm:ss` - mọi nơi hiện timestamp đầy đủ
 * (có giờ:phút:giây) phải đi qua formatDateTime/DATETIME_FORMAT ở đây,
 * không tự viết `.format('...')` riêng, để lần sau cần đổi lại chỉ sửa 1
 * chỗ. Không áp dụng cho các giá trị không phải "timestamp hiển thị cho
 * người xem" (tên file CSV, key nhóm theo tuần/tháng dùng để so sánh/tra
 * cứu nội bộ) - đổi thứ tự những chỗ đó không có ý nghĩa và tên file dạng
 * YYYY-MM-DD còn giúp sort theo tên đúng thứ tự thời gian. */
export const DATETIME_FORMAT = 'HH:mm:ss DD-MM-YYYY';

export const formatDateTime = (v?: string | null) => (v ? dayjs(v).format(DATETIME_FORMAT) : '-');

/** Bản rút gọn (không giây) của DATETIME_FORMAT - cho 1-2 chỗ hiển thị cố
 * tình gọn hơn (cột bảng hẹp, footer card) nhưng vẫn cần đồng bộ thứ tự
 * giờ-trước-ngày với phần còn lại của hệ thống. */
export const DATETIME_FORMAT_SHORT = 'HH:mm DD-MM-YYYY';

export const formatDateTimeShort = (v?: string | null) => (v ? dayjs(v).format(DATETIME_FORMAT_SHORT) : '-');
