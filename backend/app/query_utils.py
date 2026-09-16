def apply_sort(stmt, allowed_columns: dict, sort_field: str | None, sort_order: str | None, default):
    """allowed_columns maps API field name -> SQLAlchemy column. `default`
    is applied when sort_field is missing/not in the allow-list (never
    build ORDER BY from a raw client-supplied string)."""
    if sort_field and sort_field in allowed_columns:
        col = allowed_columns[sort_field]
        return stmt.order_by(col.desc() if sort_order == "descend" else col.asc())
    if isinstance(default, (list, tuple)):
        return stmt.order_by(*default)
    return stmt.order_by(default)
