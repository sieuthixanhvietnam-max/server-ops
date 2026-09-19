/** Job status (pending/running/success/failed) - shared so every place that
 * renders a job's status Tag (Job History table, JobLogPanel, Dashboard's
 * recent-activity table) reads the same color/label for the same status. */
export const JOB_STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  running: 'Đang chạy',
  success: 'Hoàn tất',
  failed: 'Thất bại',
};

export const JOB_TYPE_LABELS: Record<string, string> = {
  // WordPress - vòng đời site
  clone_wpsite: 'Clone WordPress',
  create_wpsite: 'Tạo WordPress mới',
  remove_wpsite: 'Xoá WordPress',
  migrate_wpsite: 'Di chuyển WordPress',
  change_wppass: 'Đổi mật khẩu WP',
  // Plugin & bảo trì
  plugin_check: 'Kiểm tra Plugin',
  plugin_activate: 'Bật Plugin',
  plugin_deactivate: 'Tắt Plugin',
  plugin_install_wp: 'Cài Plugin (WP.org)',
  plugin_install_zip: 'Cài Plugin (Upload ZIP)',
  plugin_update: 'Cập nhật Plugin/Core',
  theme_install_zip: 'Cài Theme (Upload ZIP)',
  mu_plugin_install: 'Triển khai MU-Plugin',
  maintenance_clear_cache: 'Xoá Cache',
  maintenance_clear_comments: 'Dọn Comment/Spam',
  maintenance_fix_permissions: 'Phân quyền file',
  maintenance_clean_junk: 'Dọn rác ổ đĩa',
  // Khôi phục
  restore_list_backups: 'Xem danh sách backup',
  restore_wpsite: 'Khôi phục WordPress',
  // Cloudflare - domain/zone
  cf_add: 'Thêm CF Domain',
  cf_remove: 'Xoá CF Domain',
  cf_change_ip: 'Đổi IP CF',
  cf_origin_port: 'Đổi Origin Port',
  cf_purge_cache: 'Xoá Cache CF',
  // Cloudflare - redirect
  cf_redirect: 'Redirect 301',
  cf_redirect_remove: 'Xoá Redirect 301',
  cf_redirect_inventory: 'Thống kê Redirect 301',
  cf_audit_redirects: 'Kiểm tra Redirect 301',
  // Cloudflare - firewall
  cf_firewall_update: 'Cập nhật Firewall',
  // Cloudflare - đồng bộ/khám phá
  cf_accounts_sync: 'Đồng bộ CF Accounts',
  cf_master_discover: 'Khám phá Master Token',
  // Kiểm tra / chẩn đoán
  check_health: 'Kiểm tra sức khoẻ Server',
  check_ns: 'Kiểm tra NS',
  check_ip: 'Kiểm tra IP',
  crawl_sitemap: 'Crawl Sitemap',
  // SEO / Index
  force_index: 'Ép Index (Force Index)',
};

// Tag color grouped by category (not per job_type - 30 distinct colors would
// be unreadable) so job types from the same feature area read as visually
// related at a glance, e.g. all Cloudflare redirect jobs share one hue.
export const JOB_TYPE_COLORS: Record<string, string> = {
  clone_wpsite: 'purple',
  create_wpsite: 'purple',
  remove_wpsite: 'purple',
  migrate_wpsite: 'purple',
  change_wppass: 'purple',
  plugin_check: 'cyan',
  plugin_activate: 'cyan',
  plugin_deactivate: 'cyan',
  plugin_install_wp: 'cyan',
  plugin_install_zip: 'cyan',
  plugin_update: 'cyan',
  theme_install_zip: 'cyan',
  mu_plugin_install: 'cyan',
  maintenance_clear_cache: 'cyan',
  maintenance_clear_comments: 'cyan',
  maintenance_fix_permissions: 'cyan',
  maintenance_clean_junk: 'cyan',
  restore_list_backups: 'volcano',
  restore_wpsite: 'volcano',
  cf_add: 'orange',
  cf_remove: 'orange',
  cf_change_ip: 'orange',
  cf_origin_port: 'orange',
  cf_purge_cache: 'orange',
  cf_redirect: 'gold',
  cf_redirect_remove: 'gold',
  cf_redirect_inventory: 'gold',
  cf_audit_redirects: 'gold',
  cf_firewall_update: 'magenta',
  cf_accounts_sync: 'geekblue',
  cf_master_discover: 'geekblue',
  check_health: 'default',
  check_ns: 'default',
  check_ip: 'default',
  crawl_sitemap: 'default',
  force_index: 'green',
};

export const JOB_TYPE_OPTIONS = Object.entries(JOB_TYPE_LABELS).map(([value, label]) => ({ value, label }));
