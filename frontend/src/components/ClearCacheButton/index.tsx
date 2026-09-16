import { ClearOutlined } from '@ant-design/icons';
import { Button, Popconfirm } from 'antd';
import React from 'react';

/** Placed in PageContainer's `extra` on every ops page - resets that page's
 * sessionStorage draft (usePersistedState) back to a fresh-load state,
 * including any tracked job id/result, not just form inputs. Each page wires
 * its own onClear since the set of persisted keys differs per page. */
const ClearCacheButton: React.FC<{ onClear: () => void }> = ({ onClear }) => (
  <Popconfirm
    title="Xóa cache trang?"
    description="Toàn bộ dữ liệu đang lưu tạm của trang này (input đang nhập, job/kết quả gần nhất) sẽ bị xoá."
    onConfirm={onClear}
    okText="Xoá cache"
    okButtonProps={{ danger: true }}
  >
    <Button icon={<ClearOutlined />}>Xóa cache trang</Button>
  </Popconfirm>
);

export default ClearCacheButton;
