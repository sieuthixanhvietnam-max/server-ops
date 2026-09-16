import type { TablePaginationConfig } from 'antd';

/** Single shared pagination style for every table in the app that paginates
 * (tables using `pagination={false}` are a separate, deliberate "show
 * everything" design and are not part of this) - same compact size, same
 * page-size default, same set of controls everywhere, so no page's
 * pagination bar looks bigger/smaller than another's. */
export const DEFAULT_PAGINATION: TablePaginationConfig = {
  size: 'small',
  defaultPageSize: 20,
  showSizeChanger: true,
  showQuickJumper: true,
};
