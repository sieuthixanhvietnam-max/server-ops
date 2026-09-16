import { searchWpOrgPlugins } from '@/services/serverOps/api';
import { Avatar, Select, Typography } from 'antd';
import React, { useRef, useState } from 'react';

type Props = {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
};

const formatInstalls = (n: number) => {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}tr+`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k+`;
  return `${n}+`;
};

/**
 * Search WordPress.org plugins by name instead of requiring the user to
 * already know the exact slug (VD: "Yoast SEO" -> slug thật là
 * "wordpress-seo"). mode="tags" so a known slug can still be typed directly
 * if the search API is slow/unreachable - see wp_org.py's fallback note.
 */
const WpOrgPluginSelect: React.FC<Props> = ({ value, onChange, placeholder }) => {
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode }[]>([]);
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = text.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const res = await searchWpOrgPlugins(q);
        setOptions(
          (res.data || []).map((p) => ({
            value: p.slug,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {p.icon ? <Avatar size={20} src={p.icon} shape="square" /> : <Avatar size={20} shape="square">{p.name[0]}</Avatar>}
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name} <Typography.Text type="secondary" style={{ fontSize: 11 }}>({p.slug})</Typography.Text>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {formatInstalls(p.active_installs)} lượt cài · {p.short_description}
                  </Typography.Text>
                </div>
              </div>
            ),
          })),
        );
      } finally {
        setFetching(false);
      }
    }, 300);
  };

  return (
    <Select
      mode="tags"
      showSearch
      allowClear
      value={value}
      onChange={(v) => onChange?.(v as string[])}
      onSearch={handleSearch}
      filterOption={false}
      loading={fetching}
      placeholder={placeholder || 'Gõ tên plugin để tìm trên WordPress.org (VD: yoast seo)...'}
      style={{ width: '100%' }}
      notFoundContent={fetching ? 'Đang tìm...' : 'Không tìm thấy - có thể gõ thẳng slug rồi Enter'}
      options={options}
    />
  );
};

export default WpOrgPluginSelect;
