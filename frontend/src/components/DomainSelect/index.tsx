import { listDomains } from '@/services/serverOps/api';
import { Select } from 'antd';
import React, { useRef, useState } from 'react';

type Props = {
  value?: string[];
  onChange?: (value: string[]) => void;
  mode?: 'multiple' | 'single';
  placeholder?: string;
  style?: React.CSSProperties;
};

/**
 * Autocomplete over the app's own synced domain inventory (/api/domains).
 * Options show which server(s) each match sits on, so an ambiguous domain
 * (present on >1 server, which every write op refuses to guess about) is
 * visible before the user even submits.
 */
const DomainSelect: React.FC<Props> = ({ value, onChange, mode = 'multiple', placeholder, style }) => {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
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
        const res = await listDomains({ domain: q, pageSize: 20, current: 1 });
        const byDomain = new Map<string, { server_name: string; server_ip: string }[]>();
        (res.data || []).forEach((d) => {
          const arr = byDomain.get(d.domain) || [];
          arr.push({ server_name: d.server_name, server_ip: d.server_ip });
          byDomain.set(d.domain, arr);
        });
        setOptions(
          Array.from(byDomain.entries()).map(([domain, servers]) => ({
            value: domain,
            label:
              servers.length > 1
                ? `${domain}  ⚠ ${servers.length} servers (mơ hồ)`
                : `${domain}  —  ${servers[0].server_name} (${servers[0].server_ip})`,
          })),
        );
      } finally {
        setFetching(false);
      }
    }, 300);
  };

  return (
    <Select
      mode={mode === 'multiple' ? 'multiple' : undefined}
      showSearch
      allowClear
      value={mode === 'multiple' ? value : value?.[0]}
      onChange={(v) => onChange?.(mode === 'multiple' ? (v as string[]) : v ? [v as unknown as string] : [])}
      onSearch={handleSearch}
      filterOption={false}
      loading={fetching}
      placeholder={placeholder || 'Gõ ít nhất 2 ký tự để tìm domain đã đồng bộ...'}
      style={{ width: '100%', ...style }}
      notFoundContent={fetching ? 'Đang tìm...' : 'Không tìm thấy'}
      options={options}
    />
  );
};

export default DomainSelect;
