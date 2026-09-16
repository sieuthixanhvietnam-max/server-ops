import { deleteSiteCredential, revealSiteCredential, setSiteCredential } from '@/services/serverOps/api';
import { formatDateTime } from '@/utils/dateFormat';
import { KeyOutlined } from '@ant-design/icons';
import { App, Button, Divider, Input, Popconfirm, Popover, theme, Tooltip, Typography } from 'antd';
import React, { useState } from 'react';

/** Per-(domain, server) WP admin credential, shown as a small key icon in
 * the Domains table - grey/outline when nothing is stored yet (click to add
 * by hand, e.g. a password never changed through this app), amber/filled
 * once something is saved (click to view, reveal, or overwrite). The same
 * cell serves both the manual-entry path and the auto-saved-by-"Đổi mật
 * khẩu Admin" path - whichever wrote last is what's shown. */
const SiteCredentialCell: React.FC<{
  domain: string;
  serverName: string;
  credential?: API.SiteCredential;
  onSaved: () => void;
}> = ({ domain, serverName, credential, onSaved }) => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState<string>();
  const [revealing, setRevealing] = useState(false);
  const [saving, setSaving] = useState(false);

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setUsername(credential?.username || '');
      setPassword('');
      setRevealed(undefined);
    }
  };

  const handleReveal = async () => {
    if (!credential) return;
    setRevealing(true);
    try {
      const res = await revealSiteCredential(credential.id);
      setRevealed(res.password);
    } finally {
      setRevealing(false);
    }
  };

  const handleSave = async () => {
    if (!username.trim() || !password) {
      message.warning('Nhập đủ username và mật khẩu');
      return;
    }
    setSaving(true);
    try {
      await setSiteCredential(domain, serverName, username.trim(), password);
      message.success('Đã lưu thông tin đăng nhập');
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!credential) return;
    await deleteSiteCredential(credential.id);
    message.success('Đã xoá');
    setOpen(false);
    onSaved();
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={openChange}
      title={credential ? 'Thông tin đăng nhập' : 'Lưu thông tin đăng nhập'}
      content={
        <div style={{ width: 260 }}>
          {credential && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Username hiện tại
              </Typography.Text>
              <div style={{ fontFamily: 'monospace' }}>{credential.username}</div>
              <div style={{ marginTop: 6 }}>
                {revealed ? (
                  <Typography.Text copyable style={{ fontFamily: 'monospace' }}>
                    {revealed}
                  </Typography.Text>
                ) : (
                  <Button size="small" loading={revealing} onClick={handleReveal}>
                    Hiện mật khẩu
                  </Button>
                )}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
                Cập nhật {formatDateTime(credential.updated_at)}
                {credential.updated_by ? ` bởi ${credential.updated_by}` : ''}
              </Typography.Text>
              <Divider style={{ margin: '10px 0' }} />
            </>
          )}

          <Typography.Text strong style={{ fontSize: 12 }}>
            {credential ? 'Sửa lại' : 'Nhập thông tin'}
          </Typography.Text>
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ marginTop: 6 }}
            size="small"
          />
          <Input.Password
            placeholder="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginTop: 6 }}
            size="small"
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {credential && (
              <Popconfirm title="Xoá thông tin đăng nhập đã lưu?" onConfirm={handleDelete}>
                <Button size="small" danger>
                  Xoá
                </Button>
              </Popconfirm>
            )}
            <Button size="small" type="primary" loading={saving} onClick={handleSave}>
              Lưu
            </Button>
          </div>
        </div>
      }
    >
      <Tooltip title={credential ? `Đã lưu (${credential.username}) - bấm để xem` : 'Chưa lưu - bấm để thêm'}>
        <KeyOutlined
          style={{ color: credential ? token.colorWarning : token.colorTextQuaternary, cursor: 'pointer', fontSize: 16 }}
        />
      </Tooltip>
    </Popover>
  );
};

export default SiteCredentialCell;
