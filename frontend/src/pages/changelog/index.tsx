import { createChangelogEntry, listChangelog } from '@/services/serverOps/api';
import {
  BugOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  App,
  AutoComplete,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

const { TextArea } = Input;

type ChangeType = API.ChangelogEntry['change_type'];

const TYPE_META: Record<ChangeType, { label: string; color: string; icon: React.ReactNode }> = {
  feature: { label: 'Tính năng mới', color: 'green', icon: <RocketOutlined /> },
  improvement: { label: 'Cải tiến', color: 'blue', icon: <ThunderboltOutlined /> },
  fix: { label: 'Sửa lỗi', color: 'volcano', icon: <BugOutlined /> },
  security: { label: 'Bảo mật', color: 'gold', icon: <SafetyCertificateOutlined /> },
};

const NO_VERSION_KEY = '__no_version__';

type VersionGroup = {
  key: string;
  version: string;
  latestAt: string;
  entries: API.ChangelogEntry[];
};

const groupByVersion = (rows: API.ChangelogEntry[]): VersionGroup[] => {
  const groups = new Map<string, VersionGroup>();
  for (const row of rows) {
    const key = row.version || NO_VERSION_KEY;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(row);
      if (row.created_at > existing.latestAt) existing.latestAt = row.created_at;
    } else {
      groups.set(key, { key, version: row.version, latestAt: row.created_at, entries: [row] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => (a.latestAt > b.latestAt ? -1 : 1));
};

const ChangelogPage: React.FC = () => {
  const { message } = App.useApp();
  const [rows, setRows] = useState<API.ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const refresh = () => {
    setLoading(true);
    listChangelog()
      .then((res) => setRows(res.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const groups = useMemo(() => groupByVersion(rows), [rows]);
  const current = groups[0];
  const knownVersions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.version).filter(Boolean))).map((v) => ({ value: v })),
    [rows],
  );

  const handleCreate = async (values: {
    version?: string;
    change_type: ChangeType;
    title: string;
    description?: string;
  }) => {
    setSaving(true);
    try {
      await createChangelogEntry(
        values.version?.trim() || '',
        values.change_type,
        values.title.trim(),
        values.description?.trim() || '',
      );
      message.success('Đã thêm bản ghi changelog');
      setModalOpen(false);
      form.resetFields();
      refresh();
    } catch (e: any) {
      message.error(e?.message || 'Không thêm được');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer
      title="Phiên bản hệ thống"
      subTitle="Lịch sử các bản fix, nâng cấp đã triển khai lên production"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Thêm bản ghi
        </Button>
      }
    >
      <Card
        style={{ marginBottom: 24 }}
        styles={{ body: { padding: 20 } }}
      >
        {current ? (
          <Space direction="vertical" size={6}>
            <Space size={10} align="center">
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                ĐANG CHẠY
              </Typography.Text>
              <Tag color="processing" style={{ fontSize: 15, padding: '2px 12px', fontWeight: 600 }}>
                {current.version || 'Chưa gắn phiên bản'}
              </Tag>
            </Space>
            <Typography.Text style={{ fontSize: 13 }} type="secondary">
              Cập nhật lần cuối {new Date(current.latestAt).toLocaleString('vi-VN')} · {current.entries.length} thay
              đổi trong bản này
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">Chưa có bản ghi changelog nào - bấm "Thêm bản ghi" để bắt đầu.</Typography.Text>
        )}
      </Card>

      {groups.length === 0 && !loading ? (
        <Empty description="Chưa có dữ liệu" />
      ) : (
        <Timeline
          items={groups.map((g) => ({
            key: g.key,
            color: g.key === NO_VERSION_KEY ? 'gray' : 'blue',
            children: (
              <div style={{ paddingBottom: 8 }}>
                <Space align="baseline" style={{ marginBottom: 8 }}>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {g.version || 'Chưa gắn phiên bản'}
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(g.latestAt).toLocaleDateString('vi-VN')}
                  </Typography.Text>
                </Space>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {g.entries.map((e) => {
                    const meta = TYPE_META[e.change_type] || TYPE_META.fix;
                    return (
                      <Card key={e.id} size="small" style={{ background: 'rgba(0,0,0,0.02)' }}>
                        <Space direction="vertical" size={2}>
                          <Space size={8}>
                            <Tag icon={meta.icon} color={meta.color}>
                              {meta.label}
                            </Tag>
                            <Typography.Text strong>{e.title}</Typography.Text>
                          </Space>
                          {e.description && (
                            <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                              {e.description}
                            </Typography.Text>
                          )}
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(e.created_at).toLocaleString('vi-VN')} · {e.created_by}
                          </Typography.Text>
                        </Space>
                      </Card>
                    );
                  })}
                </Space>
              </div>
            ),
          }))}
        />
      )}

      <Modal
        title="Thêm bản ghi changelog"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ change_type: 'fix' }}>
          <Form.Item name="version" label="Phiên bản (không bắt buộc)">
            <AutoComplete options={knownVersions} placeholder="VD: v1.3.0 - để trống nếu chưa gắn version" />
          </Form.Item>
          <Form.Item name="change_type" label="Loại thay đổi" rules={[{ required: true }]}>
            <Select
              options={Object.entries(TYPE_META).map(([value, m]) => ({
                value,
                label: (
                  <Space>
                    {m.icon}
                    {m.label}
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="Nội dung" rules={[{ required: true, message: 'Nhập nội dung' }]}>
            <Input placeholder="VD: Fix bug đồng bộ domain khi server downtime" />
          </Form.Item>
          <Form.Item name="description" label="Chi tiết (không bắt buộc)">
            <TextArea rows={3} placeholder="Mô tả thêm nếu cần..." />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ChangelogPage;
