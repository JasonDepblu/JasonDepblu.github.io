#%%
import os

# 从环境变量读取API KEY
api_key = os.environ.get("PINECONE_API_KEY")

#%%
from pinecone import Pinecone, ServerlessSpec

pc = Pinecone(api_key="")

#%%
index_name = "jasonsblog"

pc.create_index(
    name=index_name,
    dimension=1024, # Replace with your model dimensions
    metric="cosine", # Replace with your model metric
    spec=ServerlessSpec(
        cloud="aws",
        region="us-east-1"
    )
)

#%%