from fastapi import APIRouter, Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, Counter

router = APIRouter()

REQUEST_COUNT = Counter('veritas_data_pipeline_requests_total', 'Total requests to the data pipeline')

@router.get('/metrics')
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST) 