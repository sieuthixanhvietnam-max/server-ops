import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormCheckbox, ProFormText } from '@ant-design/pro-components';
import { Helmet, useIntl, useModel } from '@umijs/max';
import { Alert, App } from 'antd';
import { createStyles } from 'antd-style';
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { Footer } from '@/components';
import { login } from '@/services/serverOps/auth';
import Settings from '../../../../config/defaultSettings';

const useStyles = createStyles(({ token, css }) => ({
  page: css`
    display: flex;
    min-height: 100vh;
    background: ${token.colorBgContainer};
  `,
  brandPanel: css`
    position: relative;
    display: none;
    flex-direction: column;
    justify-content: center;
    width: 42%;
    min-width: 420px;
    overflow: hidden;
    padding: 64px;
    background: linear-gradient(155deg, #40a9ff 0%, #1890ff 45%, #0050b3 100%);

    @media (min-width: 992px) {
      display: flex;
    }
  `,
  brandBlobOne: css`
    position: absolute;
    top: -120px;
    right: -120px;
    width: 360px;
    height: 360px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
  `,
  brandBlobTwo: css`
    position: absolute;
    bottom: -160px;
    left: -100px;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
  `,
  brandContent: css`
    position: relative;
    z-index: 1;
    color: #fff;
  `,
  brandLogo: css`
    width: 56px;
    height: 56px;
    border-radius: 14px;
    margin-bottom: 32px;
  `,
  brandTitle: css`
    margin: 0 0 12px;
    font-size: 32px;
    font-weight: 700;
    color: #fff;
  `,
  brandSubtitle: css`
    max-width: 380px;
    font-size: 15px;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.85);
  `,
  formPanel: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 100vh;
  `,
  formBody: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
  `,
  formCard: css`
    width: 100%;
    max-width: 380px;
  `,
  mobileLogoRow: css`
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 32px;

    img {
      width: 40px;
      height: 40px;
      border-radius: 10px;
    }

    span {
      font-size: 22px;
      font-weight: 700;
      color: ${token.colorText};
    }

    @media (min-width: 992px) {
      display: none;
    }
  `,
}));

const LoginMessage: React.FC<{ content: string }> = ({ content }) => (
  <Alert style={{ marginBottom: 24 }} message={content} type="error" showIcon />
);

const Login: React.FC = () => {
  const [loginFailed, setLoginFailed] = useState(false);
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      flushSync(() => {
        setInitialState((s) => ({ ...s, currentUser: userInfo }));
      });
    }
  };

  const handleSubmit = async (values: { username?: string; password?: string }) => {
    try {
      const result = await login({ ...values, type: 'account' });
      if (result.status === 'ok') {
        message.success('Đăng nhập thành công!');
        await fetchUserInfo();
        const urlParams = new URL(window.location.href).searchParams;
        window.location.href = urlParams.get('redirect') || '/';
        return;
      }
      setLoginFailed(true);
    } catch {
      message.error('Đăng nhập thất bại, vui lòng thử lại!');
    }
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>
          {intl.formatMessage({ id: 'menu.login', defaultMessage: 'Đăng nhập' })}
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>

      <div className={styles.brandPanel}>
        <div className={styles.brandBlobOne} />
        <div className={styles.brandBlobTwo} />
        <div className={styles.brandContent}>
          <img alt="logo" src="/logo.svg" className={styles.brandLogo} />
          <h1 className={styles.brandTitle}>Server Ops</h1>
          <p className={styles.brandSubtitle}>
            Quản lý tập trung server, domain và Cloudflare zone cho đội vận hành - đồng bộ dữ liệu, chạy
            tác vụ hàng loạt và theo dõi lịch sử thao tác trên cùng một nơi.
          </p>
        </div>
      </div>

      <div className={styles.formPanel}>
        <div className={styles.formBody}>
          <div className={styles.formCard}>
            <div className={styles.mobileLogoRow}>
              <img alt="logo" src="/logo.svg" />
              <span>Server Ops</span>
            </div>

            <LoginForm
              contentStyle={{ minWidth: 280, maxWidth: '100%' }}
              submitter={{ searchConfig: { submitText: 'Đăng nhập' } }}
              initialValues={{ autoLogin: true }}
              onFinish={async (values) => {
                await handleSubmit(values as { username?: string; password?: string });
              }}
            >
              {loginFailed && <LoginMessage content="Sai tên đăng nhập hoặc mật khẩu" />}
              <ProFormText
                name="username"
                fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
                placeholder="Tên đăng nhập"
                rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập!' }]}
              />
              <ProFormText.Password
                name="password"
                fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
                placeholder="Mật khẩu"
                rules={[{ required: true, message: 'Vui lòng nhập mật khẩu!' }]}
              />
              <div style={{ marginBottom: 24 }}>
                <ProFormCheckbox noStyle name="autoLogin">
                  Ghi nhớ đăng nhập
                </ProFormCheckbox>
              </div>
            </LoginForm>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
};

export default Login;
