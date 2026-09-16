/** Converts ProTable's `sort` argument (e.g. `{ domain: 'descend' }`) into
 * the `sort_field`/`sort_order` query params our backend list endpoints
 * understand. Only single-column sort is used across this app. */
export function toSortParams(sort?: Record<string, any>) {
  const field = sort ? Object.keys(sort)[0] : undefined;
  return field ? { sort_field: field, sort_order: sort![field] } : {};
}
