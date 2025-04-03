#%%


# %%
import os
import glob
import re
import yaml
import json
import uuid
import time
from pathlib import Path
import requests
from pinecone import Pinecone

# 使用新版 UnstructuredLoader 替换旧版 UnstructuredFileLoader
from langchain_community.document_loaders import UnstructuredMarkdownLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

# %%
# 定义路径 - 直接读取 _posts 文件夹，而非 _site
POSTS_DIR = "/Users/depblu/Library/Mobile Documents/com~apple~CloudDocs/POSTS"
BATCH_SIZE = 20  # 为更好错误处理而减少批次大小

# 初始化 Pinecone
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
if not PINECONE_API_KEY:
    raise ValueError("PINECONE_API_KEY 环境变量是必须的")

PINECONE_ENVIRONMENT = os.environ.get("PINECONE_ENVIRONMENT")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME")
PINECONE_DIMENSION = 1024  # bge-m3 的维度

pc = Pinecone(api_key=PINECONE_API_KEY)

# 如果索引不存在则创建索引
try:
    index_list = pc.list_indexes()
    if PINECONE_INDEX_NAME not in [index.name for index in index_list.indexes]:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            spec={"dimension": PINECONE_DIMENSION, "metric": "cosine"}
        )
        print(f"Created new index: {PINECONE_INDEX_NAME}")
    else:
        print(f"Using existing index: {PINECONE_INDEX_NAME}")
except Exception as e:
    print(f"Error setting up Pinecone index: {e}")
    raise

index = pc.Index(PINECONE_INDEX_NAME)

# 初始化 Silicone Flow API 凭据
SILICONE_API_KEY = os.environ.get("SILICONE_API_KEY")
if not SILICONE_API_KEY:
    raise ValueError("SILICONE_API_KEY 环境变量是必须的")

EMBEDDING_MODEL = "Pro/BAAI/bge-m3"


# %%
# 测试 Silicone Flow API 连接
def test_api_connection():
    """测试 Silicone Flow API 的连接"""
    url = "https://api.siliconflow.cn/v1/embeddings"
    headers = {
        "Authorization": f"Bearer {SILICONE_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": "This is a test.",
        "encoding_format": "float"
    }
    try:
        response = requests.request("POST", url, json=payload, headers=headers)
        if response.status_code == 200:
            print("API connection test successful!")
            return True
        else:
            print(f"API connection test failed with status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print(f"API connection test failed with error: {e}")
        return False


# %%
def get_embedding(text, retries=3, delay=2):
    """使用 Silicone Flow API 并带有重试逻辑生成 embedding"""
    if not text or len(text.strip()) == 0:
        print("Warning: Empty text provided. Skipping embedding generation.")
        return None

    headers = {
        "Authorization": f"Bearer {SILICONE_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": text
    }
    for attempt in range(retries):
        try:
            response = requests.post(
                url="https://api.siliconflow.cn/v1/embeddings",
                headers=headers,
                json=payload,
                timeout=30  # 增加超时时间
            )
            if response.status_code == 200:
                return response.json()["data"][0]["embedding"]
            elif response.status_code == 429:
                wait_time = delay * (2 ** attempt)
                print(f"Rate limit hit, waiting {wait_time} seconds...")
                time.sleep(wait_time)
                continue
            else:
                print(f"Error getting embedding: {response.text}")
                if attempt < retries - 1:
                    wait_time = delay * (2 ** attempt)
                    print(f"Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)
                    continue
                return None
        except Exception as e:
            print(f"Exception when getting embedding: {e}")
            if attempt < retries - 1:
                wait_time = delay * (2 ** attempt)
                print(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
                continue
            return None
    return None


# %%
# 使用新版 UnstructuredLoader 加载 Markdown 文件
def load_markdown_file(file_path):
    """使用 UnstructuredLoader 加载 Markdown 文件"""
    try:
        loader = UnstructuredMarkdownLoader(file_path)
        docs = loader.load()
        if docs:
            doc = docs[0]
            metadata = doc.metadata if hasattr(doc, "metadata") else {}
            content = doc.page_content if hasattr(doc, "page_content") else ""
            return metadata, content
        else:
            return {}, ""
    except Exception as e:
        print(f"Error loading file {file_path}: {e}")
        return {}, ""


# %%
# 处理并索引所有 Markdown 文件（使用 RecursiveCharacterTextSplitter 分块）
def process_and_index_files():
    """处理并索引 posts 目录中的所有 Markdown 文件"""
    markdown_files = glob.glob(os.path.join(POSTS_DIR, "**/*.md"), recursive=True)
    markdown_files.extend(glob.glob(os.path.join(POSTS_DIR, "**/*.markdown"), recursive=True))
    print(f"Found {len(markdown_files)} md files to index")

    if not test_api_connection():
        print("API connection test failed. Please check your API key and connection.")
        return

    vectors_batch = []
    successful_posts = 0

    for file_path in markdown_files:
        try:
            basename = os.path.basename(file_path)
            # 从 Jekyll 文件名格式（YYYY-MM-DD-title.md）中提取日期和 slug
            match = re.match(r'(\d{4}-\d{2}-\d{2})-(.*)\.(md|markdown)', basename)
            if match:
                date_str, slug = match.groups()[0:2]
                url_path = f"/myblog/posts/{slug}/"
            else:
                url_path = f"/myblog/posts/{Path(file_path).stem}/"

            # 使用新版 UnstructuredLoader 加载文件
            frontmatter, content = load_markdown_file(file_path)
            if not content:
                print(f"Skipping {file_path} - empty content")
                continue

            title = frontmatter.get("title", os.path.basename(file_path))

            # 使用 RecursiveCharacterTextSplitter 进行文本分块
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
            chunks = text_splitter.split_text(content)
            post_vectors = []

            for i, chunk in enumerate(chunks):
                vector_id = str(uuid.uuid4())
                embedding = get_embedding(chunk)
                if embedding:
                    vector = {
                        "posts",
                              [
                                  {
                                    "id": vector_id,
                                    "values": embedding,
                                    "metadata":
                                        {
                                            "title": title,
                                            "url": url_path,
                                            "content": chunk,
                                            "chunk_index": i,
                                            "source_file": basename,
                                            "date": frontmatter.get("date", ""),
                                            "categories": frontmatter.get("categories", []),
                                            "tags": frontmatter.get("tags", [])
                                        }
                                  }
                              ]
                    }
                    post_vectors.append(vector)
                    vectors_batch.append(vector)
                    # 批量索引
                    if len(vectors_batch) >= BATCH_SIZE:
                        try:
                            index.upsert(vectors=vectors_batch)
                            print(f"Indexed batch of {len(vectors_batch)} vectors")
                            vectors_batch = []
                        except Exception as e:
                            print(f"Error indexing batch: {e}")
                            vectors_batch = []
                else:
                    print(f"Skipping chunk {i} from {file_path} - no embedding generated")

            if post_vectors:
                successful_posts += 1
                print(f"Successfully processed: {title} - {len(post_vectors)} chunks")

        except Exception as e:
            print(f"Error processing file {file_path}: {e}")

    # 索引剩余的向量
    if vectors_batch:
        try:
            index.upsert(vectors=vectors_batch)
            print(f"Indexed final batch of {len(vectors_batch)} vectors")
        except Exception as e:
            print(f"Error indexing final batch: {e}")

    print(f"Indexing complete! Successfully processed {successful_posts} out of {len(markdown_files)} posts.")


# %%
# 添加基于 Pinecone 的检索功能
from langchain.embeddings.base import Embeddings
from langchain.vectorstores import Pinecone as LC_Pinecone


class SiliconeEmbedding(Embeddings):
    def embed_query(self, text: str) -> list[float]:
        embedding = get_embedding(text)
        if embedding is None:
            raise ValueError("Failed to generate embedding for the query.")
        return embedding

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]


def create_retriever():
    embedding_fn = SiliconeEmbedding()
    # 移除 pinecone_index 参数，直接通过 index_name 进行初始化
    vectorstore = LC_Pinecone.from_existing_index(
        index_name=PINECONE_INDEX_NAME,
        embedding=embedding_fn
    )
    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    return retriever


def search_posts(query):
    retriever = create_retriever()
    results = retriever.get_relevant_documents(query)
    print("Search results:")
    for doc in results:
        title = doc.metadata.get("title", "No Title")
        url = doc.metadata.get("url", "")
        print(f"Title: {title}, URL: {url}")


# %%
if __name__ == "__main__":
    process_and_index_files()
    query = input("Enter search query: ")
    search_posts(query)