import { history } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const NoFoundPage: React.FC = () => (
  <Card variant="borderless">
    <Result
      status="404"
      title="404"
      subTitle="Rất tiếc, trang bạn truy cập không tồn tại."
      extra={
        <Button type="primary" onClick={() => history.push('/')}>
          Về trang chủ
        </Button>
      }
    />
  </Card>
);

export default NoFoundPage;
