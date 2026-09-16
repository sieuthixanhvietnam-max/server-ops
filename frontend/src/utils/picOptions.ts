/** Sentinel `pic` filter value meaning "has no PIC assigned at all" - mirrors
 * the backend's `pic_service.UNASSIGNED` constant. */
export const PIC_UNASSIGNED = '__unassigned__';

/** Builds the options list for a PIC *filter* dropdown (as opposed to a PIC
 * *editor* multi-select) - prepends a "Chưa gán" choice so users can isolate
 * the review queue directly from any list page, not just the Pics page. */
export function toPicFilterOptions(pics: { code: string }[]) {
  return [
    { label: 'Chưa gán PIC', value: PIC_UNASSIGNED },
    ...pics.map((p) => ({ label: p.code, value: p.code })),
  ];
}
