"""
LanceDB client for the Python pipeline.
Mirrors the TS storage/lance/lance.client.ts.
"""

import lancedb
import logging
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / ".lancedb"

class LanceClient:
    """Wrapper around lancedb for Python."""
    
    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self.db_path = str(db_path)
        self.db = None
        
    def connect(self):
        if self.db is None:
            self.db = lancedb.connect(self.db_path)
            logger.info(f"[LanceClient] Connected to {self.db_path}")
        return self.db

    def close(self):
        self.db = None

    def open_table(self, table_name: str):
        db = self.connect()
        if table_name in db.table_names():
            return db.open_table(table_name)
        return None

    def create_table(self, table_name: str, data: List[Dict[str, Any]]):
        db = self.connect()
        if table_name in db.table_names():
            return db.open_table(table_name)
        return db.create_table(table_name, data=data)

    def add_to_table(self, table_name: str, data: List[Dict[str, Any]]):
        if not data:
            return None
            
        table = self.open_table(table_name)
        if table is None:
            return self.create_table(table_name, data)
        else:
            table.add(data)
            return table

    def vector_search(self, table_name: str, query_vector: List[float], top_k: int = 10, distance_type: str = "cosine"):
        table = self.open_table(table_name)
        if table is None:
            return []
            
        return table.search(query_vector).metric(distance_type).limit(top_k).to_list()
