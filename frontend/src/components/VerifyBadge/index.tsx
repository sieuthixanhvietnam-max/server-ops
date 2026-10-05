import { CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { Space, Tag, Tooltip, theme } from 'antd';
import React from 'react';

const VerifyBadge: React.FC<{ verify?: API.VerifyInfo }> = ({ verify }) => {
  const { token } = theme.useToken();
  if (!verify) return <MinusCircleOutlined style={{ color: token.colorTextQuaternary }} />;

  const success = verify.gone !== undefined ? verify.gone : !!verify.ok;
  const label = verify.http_status > 0 ? `HTTP ${verify.http_status}` : 'Không phản hồi';

  // Check chạy trực tiếp trên server qua SSH (curl với Host header ghim vào
  // domain), không đi qua DNS/NS công khai - nên domain chưa có NS/NS còn
  // pending vẫn có thể hiện HTTP 200 ở đây, vì đây là xác nhận "site đã lên
  // trên server", không phải "domain đã phân giải công khai".
  const tooltip = (
    <>
      {verify.note}
      <br />
      <span style={{ opacity: 0.7 }}>
        (Kiểm tra trực tiếp trên server qua SSH, không phụ thuộc NS/DNS công khai)
      </span>
    </>
  );

  // site_url_ok/ssl_ok chỉ có ở clone/create-wpsite, và chỉ khi HTTP đã OK
  // (xem wp_ops._verify_chunk) - mọi job type khác dùng VerifyInfo sẽ
  // không có 2 field này, nên 2 badge phụ chỉ hiện khi thật sự có dữ liệu.
  const hasSiteUrlCheck = verify.site_url_ok !== undefined;
  const hasSslCheck = verify.ssl_ok !== undefined;

  return (
    <Space size={4}>
      <Tooltip title={tooltip}>
        <Tag
          color={success ? 'success' : 'error'}
          icon={success ? <CheckCircleFilled /> : <CloseCircleFilled />}
          style={{ cursor: 'default' }}
        >
          {label}
        </Tag>
      </Tooltip>
      {hasSiteUrlCheck && (
        <Tooltip title={verify.site_url_note}>
          <Tag
            color={verify.site_url_ok ? 'success' : 'error'}
            icon={verify.site_url_ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
            style={{ cursor: 'default' }}
          >
            siteurl
          </Tag>
        </Tooltip>
      )}
      {hasSslCheck && (
        <Tooltip title={verify.ssl_note}>
          <Tag
            color={verify.ssl_ok ? 'success' : 'error'}
            icon={verify.ssl_ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
            style={{ cursor: 'default' }}
          >
            SSL
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
};

export default VerifyBadge;
