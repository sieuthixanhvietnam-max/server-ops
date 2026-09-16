import { PageContainer } from '@ant-design/pro-components';
import { Collapse, Tabs, Tag, Typography } from 'antd';
import React from 'react';

const { Paragraph, Text } = Typography;

type Entry = {
  key: string;
  title: string;
  purpose: string;
  usage: string[];
  notes?: string[];
};

type Group = {
  key: string;
  label: string;
  entries: Entry[];
};

const GROUPS: Group[] = [
  {
    key: 'data',
    label: 'Dữ liệu',
    entries: [
      {
        key: 'domains',
        title: 'Domain',
        purpose: 'Danh sách toàn bộ domain đang host trên các server, đồng bộ tự động từ server monitoring.',
        usage: [
          'Dùng ô tìm kiếm để lọc theo 1 domain/server/provider, hoặc nút "Lọc theo danh sách" ở góc trên để dán nhiều domain cùng lúc (khớp chính xác, không phải chứa chuỗi con).',
          'Tick chọn nhiều dòng rồi bấm "Hành động" để điều hướng nhanh sang Xoá site / Đổi mật khẩu / Clone - danh sách đã chọn được điền sẵn ở trang đích.',
          '"Đồng bộ ngay" ép chạy lại đồng bộ ngay lập tức thay vì chờ chu kỳ tự động.',
        ],
        notes: ['Dữ liệu chỉ mới bằng lần đồng bộ gần nhất (mặc định 10 phút/lần) - domain vừa tạo có thể chưa xuất hiện ngay.'],
      },
      {
        key: 'servers',
        title: 'Server',
        purpose: 'Danh sách server (GCP/Ali/DO) đang được hệ thống quản lý, kèm PIC/Team phụ trách.',
        usage: [
          'Lọc theo provider/profile, hoặc dùng "Lọc theo danh sách" để tìm đúng 1 tập server cụ thể.',
          'Cột PIC có thể sửa trực tiếp tại bảng (click vào để gán/đổi PIC phụ trách).',
        ],
      },
      {
        key: 'pics',
        title: 'Theo PIC',
        purpose: 'PIC (người/nhóm phụ trách) là cách tổ chức server và tài khoản Cloudflare - trang này giúp phát hiện lệch phân công.',
        usage: ['Xem báo cáo domain host ở server thuộc PIC này nhưng zone Cloudflare lại nằm ở account của PIC khác - dấu hiệu cấu hình nhầm.'],
      },
      {
        key: 'cf-accounts',
        title: 'Tài khoản Cloudflare',
        purpose: 'Danh sách toàn bộ account Cloudflare mà hệ thống biết, đồng bộ tự động qua master token.',
        notes: ['Dữ liệu chỉ đọc, tự động đồng bộ - không sửa tay ở đây.'],
        usage: [],
      },
      {
        key: 'cf-domains',
        title: 'Domain Cloudflare',
        purpose: 'So khớp domain giữa dữ liệu server (đã đồng bộ) và zone thật trên Cloudflare - phát hiện domain chỉ có 1 bên (thiếu zone CF, hoặc zone CF mồ côi không còn site).',
        usage: [
          'Xem 3 số liệu tổng quan: domain có cả 2 bên, chỉ có trên CF, chỉ có trên server.',
          '"Lọc theo danh sách" để kiểm tra nhanh 1 tập domain cụ thể có đồng bộ đúng không.',
        ],
      },
      {
        key: 'cf-whitelist',
        title: 'Whitelist IP',
        purpose: 'Danh sách IP được bỏ qua bởi bộ Firewall rule chuẩn (bot/office IP) - áp dụng cho mọi domain khi chạy "Firewall".',
        usage: ['Sửa danh sách ở đây xong phải quay lại trang "Firewall" (Tác vụ Cloudflare) và chạy áp dụng lại - sửa ở đây không tự đẩy lên zone đang chạy.'],
      },
    ],
  },
  {
    key: 'monitor',
    label: 'Giám sát',
    entries: [
      {
        key: 'job-history',
        title: 'Lịch sử Job',
        purpose: 'Toàn bộ job (tác vụ) đã chạy trên hệ thống - ai chạy, lúc nào, kết quả gì.',
        usage: ['Dùng để tra lại kết quả 1 job cũ (kể cả sau khi rời trang task), hoặc kiểm tra ai đã thực hiện 1 thao tác.'],
      },
      {
        key: 'domain-changes',
        title: 'Thay đổi Domain',
        purpose: 'Lịch sử domain được thêm/xoá khỏi server, phát hiện từ mỗi lần đồng bộ.',
        usage: ['Hữu ích khi cần biết 1 domain từng nằm trên server nào trước khi bị xoá (VD trước khi khôi phục từ backup).'],
      },
      {
        key: 'access-control',
        title: 'Kiểm soát truy cập',
        purpose: 'Quản lý tài khoản đăng nhập hệ thống và danh sách IP được phép truy cập.',
        usage: ['Chỉ admin tạo tài khoản/đặt lại mật khẩu - user không tự đổi mật khẩu của mình.'],
        notes: ['Mật khẩu tạo mới chỉ hiển thị 1 lần duy nhất - phải copy và gửi ngay cho người dùng lúc đó.'],
      },
    ],
  },
  {
    key: 'server-task',
    label: 'Tác vụ Server',
    entries: [
      {
        key: 'clone-wpsite',
        title: 'Clone WordPress',
        purpose: 'Nhân bản 1 site WordPress đang chạy (nguồn) sang domain đích - server tự xác định từ domain nguồn, luôn clone trong cùng server.',
        usage: [
          'Nhập cặp domain nguồn/đích (hoặc "Nhập hàng loạt" dán từ Sheet), bấm "Kiểm tra trạng thái Cloudflare" để biết đích đã có zone CF chưa.',
          'Đích chưa có zone: dùng khối "Thêm vào Cloudflare" ngay trong trang để tạo zone trước khi clone.',
          'Sau khi clone thật xong, có nút "Chuyển sang Redirect 301" điền sẵn domain nguồn → đích để tạo redirect gom traffic (tự kiểm tra lại trước khi chạy, vì đôi khi domain nguồn là template dùng lại nhiều lần, không phải lúc nào cũng nên redirect).',
        ],
        notes: ['Nếu domain đích đã có site đang chạy, site cũ sẽ bị XOÁ trước khi clone đè lên.'],
      },
      {
        key: 'create-wpsite',
        title: 'Tạo WordPress mới',
        purpose: 'Tạo hàng loạt domain mới từ 1 site nguồn dùng làm template, trên cùng 1 server đích.',
        usage: ['Chọn domain nguồn (template) + server đích, dán danh sách domain mới cần tạo, kiểm tra CF rồi chạy.'],
        notes: ['Domain đích PHẢI có zone Cloudflare trước khi tạo - dùng khối "Thêm vào Cloudflare" trong trang nếu còn thiếu.'],
      },
      {
        key: 'plugin-manager',
        title: 'Quản lý Plugin',
        purpose: 'Kiểm tra/bật-tắt/cài đặt/cập nhật plugin WordPress hàng loạt trên nhiều domain.',
        usage: [
          'Chọn domain đích bằng cách: thêm cả server, tìm+chọn từng domain, hoặc "Dán danh sách" (paste nhiều domain cùng lúc, tự kiểm tra domain có tồn tại trong dữ liệu đã đồng bộ không).',
          'Danh sách domain đã chọn dùng chung cho mọi tab (Kiểm tra/Bật-tắt/Cài WP/Cài Zip/Cập nhật) - không cần chọn lại khi đổi tab.',
        ],
      },
      {
        key: 'wp-maintenance',
        title: 'Bảo trì WordPress',
        purpose: 'Xoá cache và quản lý bình luận hàng loạt trên nhiều domain.',
        usage: ['Chọn domain giống Quản lý Plugin (thêm cả server / tìm từng domain / dán danh sách).'],
      },
      {
        key: 'check-health',
        title: 'Sức khoẻ Server',
        purpose: 'Kiểm tra CPU/RAM/Disk/uptime qua SSH cho 1 hoặc nhiều server.',
        usage: ['Để trống ô chọn server = kiểm tra tất cả.'],
      },
      {
        key: 'change-wppass',
        title: 'Đổi mật khẩu WordPress',
        purpose: 'Đổi mật khẩu admin WordPress hàng loạt - mặc định mỗi domain 1 mật khẩu ngẫu nhiên riêng.',
        usage: ['Có thể bật "Dùng mật khẩu tuỳ chỉnh" để đặt 1 mật khẩu cố định cho tất cả (không khuyến khích, kém an toàn hơn).'],
        notes: ['Mật khẩu mới hiển thị trong bảng kết quả sau khi chạy - nên dùng "Xoá cache trang" sau khi đã lưu lại, tránh mật khẩu cũ còn hiển thị nếu quay lại trang sau này.'],
      },
      {
        key: 'restore-wpsite',
        title: 'Khôi phục WordPress',
        purpose: 'Khôi phục site từ bản backup R2 (chạy tự động hàng ngày) sang server đích.',
        usage: ['Nhập domain nguồn (nơi có backup) + server đích, hệ thống liệt kê các bản backup theo ngày để chọn.'],
        notes: ['Có cảnh báo chéo nếu domain từng bị xoá khỏi 1 server KHÁC với server nguồn đang nhập - kiểm tra kỹ trước khi khôi phục nhầm.'],
      },
      {
        key: 'remove-wpsite',
        title: 'Xoá WordPress',
        purpose: 'Xoá vĩnh viễn database, file, cron, SSL của 1 site WordPress trên server - KHÔNG đụng tới zone Cloudflare.',
        usage: ['Chọn từ danh sách đã đồng bộ hoặc dán danh sách tay.'],
        notes: ['Sau khi xoá thật xong, có nút "Chuyển sang Xoá khỏi Cloudflare" nếu muốn dọn luôn zone CF - chỉ bấm khi chắc chắn không cần domain đó nữa, vì có trường hợp chỉ muốn xoá site WP mà vẫn giữ zone CF dùng sau.'],
      },
    ],
  },
  {
    key: 'cf-task',
    label: 'Tác vụ Cloudflare',
    entries: [
      {
        key: 'cf-add',
        title: 'Thêm Domain',
        purpose: 'Tạo zone Cloudflare mới cho domain (DNS + SSL + Firewall mặc định) - dùng khi domain chưa có trên Cloudflare.',
        usage: ['Account CF đích được tự gợi ý theo PIC của server sở hữu IP - có thể chọn tay account khác.'],
      },
      {
        key: 'zone-tools',
        title: 'Công cụ Zone',
        purpose: 'Bộ công cụ nhanh cho 1 zone Cloudflare: kiểm tra IP/NS, đổi IP, đổi Origin Port, xoá cache.',
        usage: ['"Kiểm tra IP"/"Kiểm tra NS" chạy ngay không cần xác nhận (read-only); các hành động còn lại đều có dry-run + xác nhận trước khi chạy thật.'],
      },
      {
        key: 'cf-redirect',
        title: 'Redirect 301',
        purpose: 'Tạo Page Rule redirect 301 từ domain nguồn sang domain/URL đích trên Cloudflare.',
        usage: [
          '2 chế độ: "URL → URL" (giữ nguyên path) hoặc "URL → Homepage" (đổ tất cả về 1 URL cố định).',
          'Tick "Crawl sitemap domain đích" để sau khi redirect xong, có thể bấm thẳng sang "Ép Index" với dữ liệu sitemap đã crawl sẵn, không cần crawl lại.',
        ],
      },
      {
        key: 'cf-redirect-audit',
        title: 'Kiểm tra Redirect 301',
        purpose: 'Quét toàn bộ zone tìm redirect rule bất thường (trùng nhau, sai chuẩn), hoặc xuất toàn bộ danh sách redirect hiện có.',
        usage: ['Chế độ "Toàn bộ danh sách" sắp xếp theo domain đích, số domain trỏ vào - giúp thấy ngay chuỗi redirect dài (nhiều domain dồn về 1 đích) để cân nhắc dọn bớt.'],
      },
      {
        key: 'force-index',
        title: 'Ép Index',
        purpose: 'Crawl sitemap của domain đích và submit URL sang dịch vụ ép index trả phí (SpeedyIndex/InstantIndexer/LinksIndexer/RalfyIndex) để Google phát hiện nội dung nhanh hơn.',
        usage: ['Có thể vào trực tiếp (tự nhập domain + crawl), hoặc nhận sẵn dữ liệu từ trang Redirect 301 sau khi vừa tạo redirect.'],
        notes: ['Không bắt buộc làm ngay sau redirect - dùng độc lập được bất cứ lúc nào cho domain bất kỳ.'],
      },
      {
        key: 'cf-redirect-remove',
        title: 'Xoá Redirect 301',
        purpose: 'Xoá toàn bộ Page Rule redirect (forwarding_url) đang có trên domain - domain trở lại phục vụ nội dung trên server bình thường.',
        usage: [],
      },
      {
        key: 'cf-remove',
        title: 'Xoá Domain',
        purpose: 'Xoá vĩnh viễn zone Cloudflare (DNS, SSL, Firewall, mọi cấu hình) - KHÔNG đụng tới site/database trên server.',
        usage: ['Dùng "Xoá WordPress" (Tác vụ Server) cho việc xoá site - 2 thao tác độc lập, có thể chỉ cần 1 trong 2.'],
      },
      {
        key: 'cf-firewall',
        title: 'Firewall',
        purpose: 'Áp lại bộ Firewall rule chuẩn (whitelist bot/office IP, chặn country/UA/xmlrpc bất thường) lên 1 hoặc nhiều zone.',
        usage: ['Whitelist IP lấy từ trang "Whitelist IP" tại thời điểm chạy - sửa whitelist xong phải quay lại đây chạy để áp dụng.'],
        notes: ['Chế độ "Toàn bộ zone trong account" ảnh hưởng MỌI zone master token nhìn thấy, không giới hạn domain đang quản lý - cẩn trọng khi chọn chế độ này.'],
      },
    ],
  },
];

const InternalDocs: React.FC = () => (
  <PageContainer title="Tài Liệu Nội Bộ" subTitle="Hướng dẫn sử dụng từng trang trong hệ thống">
    <Paragraph type="secondary">
      Tổng hợp mục đích, cách dùng và lưu ý quan trọng cho từng trang - theo đúng nhóm menu bên trái để dễ tra
      cứu. Nội dung phản ánh đúng hành vi hiện tại của hệ thống, cập nhật cùng lúc với code khi có thay đổi.
    </Paragraph>
    <Tabs
      defaultActiveKey="server-task"
      items={GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        children: (
          <Collapse
            items={g.entries.map((e) => ({
              key: e.key,
              label: e.title,
              children: (
                <>
                  <Paragraph>{e.purpose}</Paragraph>
                  {e.usage.length > 0 && (
                    <>
                      <Text strong>Cách dùng</Text>
                      <ul style={{ marginTop: 4 }}>
                        {e.usage.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {e.notes && e.notes.length > 0 && (
                    <>
                      <Tag color="gold" style={{ marginTop: 4 }}>
                        Lưu ý
                      </Tag>
                      <ul style={{ marginTop: 4 }}>
                        {e.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ),
            }))}
          />
        ),
      }))}
    />
  </PageContainer>
);

export default InternalDocs;
