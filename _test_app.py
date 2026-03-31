
from fastapi import FastAPI
from pydantic import BaseModel
app = FastAPI()
class Body(BaseModel):
    name: str
@app.post('/test')
def test_post(b: Body):
    return {'got': b.name}
@app.get('/hello')
def hello():
    return {'hi': 1}
