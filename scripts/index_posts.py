import os
import glob
import re
import yaml
import markdown
import json
import uuid
from pathlib import Path
import requests
from pinecone import Pinecone

# Define paths
POSTS_DIR = "/Users/depblu/Documents/GitHub/JasonDepblu.github.io/myblog/_posts"
BATCH_SIZE = 100  # Number of documents to index at once

# Initialize Pinecone
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_ENVIRONMENT = os.environ.get("PINECONE_ENVIRONMENT", "gcp-starter")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME", "blog-content")
PINECONE_DIMENSION = 1024  # Dimensions for bge-m3

pc = Pinecone(api_key=PINECONE_API_KEY)

# Create index if it doesn't exist
try:
    index_list = pc.list_indexes()
    if PINECONE_INDEX_NAME not in index_list:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=PINECONE_DIMENSION,
            metric="cosine"
        )
        print(f"Created new index: {PINECONE_INDEX_NAME}")
    else:
        print(f"Using existing index: {PINECONE_INDEX_NAME}")
except Exception as e:
    print(f"Error setting up Pinecone index: {e}")
    raise

index = pc.Index(PINECONE_INDEX_NAME)

# Initialize Silicone Flow API credentials
SILICONE_API_KEY = os.environ.get("SILICONE_API_KEY")
EMBEDDING_MODEL = "Pro/BAAI/bge-m3"


def get_embedding(text):
    """Generate embedding using Silicone Flow API."""
    headers = {
        "Authorization": f"Bearer {SILICONE_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": EMBEDDING_MODEL,
        "input": text
    }

    response = requests.post(
        "https://siliconeflow.com/api/v1/embeddings",
        headers=headers,
        json=payload
    )

    if response.status_code != 200:
        raise Exception(f"Error getting embedding: {response.text}")

    return response.json()["data"][0]["embedding"]


def extract_frontmatter_and_content(file_path):
    """Extract frontmatter and content from a markdown file."""
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()

    # Extract frontmatter
    frontmatter_match = re.match(r'^---\s+(.*?)\s+---\s+(.*)', content, re.DOTALL)
    if frontmatter_match:
        frontmatter_yaml = frontmatter_match.group(1)
        content_text = frontmatter_match.group(2)
        try:
            frontmatter = yaml.safe_load(frontmatter_yaml)
        except yaml.YAMLError:
            frontmatter = {}
    else:
        frontmatter = {}
        content_text = content

    # Convert markdown to plain text
    html_content = markdown.markdown(content_text)
    # Simple regex to remove HTML tags
    plain_text = re.sub(r'<[^>]+>', ' ', html_content)
    # Normalize whitespace
    plain_text = re.sub(r'\s+', ' ', plain_text).strip()

    return frontmatter, plain_text


def chunk_text(text, max_chunk_size=1000, overlap=200):
    """Split text into chunks with overlap."""
    words = text.split()
    chunks = []

    for i in range(0, len(words), max_chunk_size - overlap):
        chunk = " ".join(words[i:i + max_chunk_size])
        chunks.append(chunk)

    return chunks


def process_and_index_files():
    """Process and index all HTML files in the posts directory."""
    # html_files = glob.glob(os.path.join(POSTS_DIR, "**/*.html"), recursive=True)
    markdown_files = glob.glob(os.path.join(POSTS_DIR, "**/*.md"), recursive=True)
    markdown_files.extend(glob.glob(os.path.join(POSTS_DIR, "**/*.markdown"), recursive=True))
    print(f"Found {len(markdown_files)} md files to index")

    vectors_batch = []

    for file_path in markdown_files:
        try:
            rel_path = os.path.relpath(file_path, POSTS_DIR)
            url_path = f"/_post/{rel_path}"

            frontmatter, content = extract_frontmatter_and_content(file_path)
            title = frontmatter.get('title', os.path.basename(file_path))

            chunks = chunk_text(content)

            for i, chunk in enumerate(chunks):
                vector_id = str(uuid.uuid4())

                # Get embedding for the chunk
                embedding = get_embedding(chunk)

                # Prepare vector for indexing
                vector = {
                    "id": vector_id,
                    "values": embedding,
                    "metadata": {
                        "title": title,
                        "url": url_path,
                        "content": chunk,
                        "chunk_index": i,
                        "source_file": file_path
                    }
                }

                vectors_batch.append(vector)

                # Index in batches
                if len(vectors_batch) >= BATCH_SIZE:
                    index.upsert(vectors=vectors_batch)
                    print(f"Indexed batch of {len(vectors_batch)} vectors")
                    vectors_batch = []

        except Exception as e:
            print(f"Error processing file {file_path}: {e}")

    # Index any remaining vectors
    if vectors_batch:
        index.upsert(vectors=vectors_batch)
        print(f"Indexed final batch of {len(vectors_batch)} vectors")

    print("Indexing complete!")


if __name__ == "__main__":
    process_and_index_files()