import os
import json
import tempfile
from pathlib import Path

# 检查是否在生产环境
is_production = os.environ.get('NODE_ENV') == 'production'

if is_production:
    # 初始化生产环境存储
    print("Using production session storage")

# 会话存储文件路径（在 Netlify Functions 中使用 /tmp）
SESSIONS_FILE = Path(tempfile.gettempdir()) / 'sessions.json'

# 从文件加载会话
def load_sessions():
    try:
        if SESSIONS_FILE.exists():
            with open(SESSIONS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f'Error loading sessions: {e}')
    return {}

# 保存会话到文件
def save_sessions(sessions):
    try:
        with open(SESSIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(sessions, f, indent=2)
    except Exception as e:
        print(f'Error saving sessions: {e}')

# 初始化会话，从文件或空对象
sessions = load_sessions()

# 获取会话
def get_session(session_id):
    # 重新加载以获取最新数据
    current_sessions = load_sessions()
    return current_sessions.get(session_id)

# 设置会话
def set_session(session_id, data):
    # 先重新加载以确保我们有最新数据
    current_sessions = load_sessions()
    current_sessions[session_id] = data
    save_sessions(current_sessions)
    # 更新内存引用
    sessions[session_id] = data
    return data

# 更新会话
def update_session(session_id, key, value):
    # 先重新加载以确保我们有最新数据
    current_sessions = load_sessions()
    if session_id not in current_sessions:
        current_sessions[session_id] = {}
    current_sessions[session_id][key] = value
    save_sessions(current_sessions)
    # 更新内存引用
    sessions[session_id] = current_sessions[session_id]
    return current_sessions[session_id]

# 获取所有会话
def get_all_sessions():
    return load_sessions()

# 为了兼容性，也可以导出这些函数
__all__ = ['sessions', 'get_session', 'set_session', 'update_session', 'get_all_sessions']