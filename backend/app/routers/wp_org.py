from fastapi import APIRouter, Depends, Query

from app.auth import get_current_username
from app.ops import wp_org

router = APIRouter(prefix="/api/wp-org", tags=["wp-org"], dependencies=[Depends(get_current_username)])


@router.get("/search-plugins")
def search_plugins(q: str = Query(..., min_length=1)):
    return {"data": wp_org.search_plugins(q), "success": True}
