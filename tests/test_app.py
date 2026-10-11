import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.app import ChatRequest, chat, conversations, requests_by_ip, source, source_cache
from backend.rag import Evidence


class ChatApiTests(unittest.TestCase):
    def setUp(self):
        conversations.clear()
        source_cache.clear()
        requests_by_ip.clear()
        self.request = SimpleNamespace(headers={}, client=SimpleNamespace(host="test-client"))
        self.source = Evidence(
            "paper-1",
            "Myoglobin oxygen binding",
            "Heme coordinates oxygen reversibly.",
            "Researcher A",
            "Journal",
            "2024",
            "https://europepmc.org/article/MED/1",
        )

    @patch("backend.app.answer_from_evidence")
    @patch("backend.app.rank_evidence")
    @patch("backend.app.search_europe_pmc")
    @patch("backend.app.classify_scope", return_value=True)
    def test_answered_contract_includes_sources_and_safe_actions(self, classify, search, rank, answer):
        search.return_value = [self.source]
        rank.return_value = [self.source]
        answer.return_value = (
            "Heme binds oxygen [S1].",
            [0],
            [{"type": "select_ligand", "target": "A:154:HEM", "label": "Highlight HEM", "object_id": "object-1"}],
        )

        result = asyncio.run(chat(ChatRequest(question="How does myoglobin bind oxygen?"), self.request))

        self.assertEqual(result["disposition"], "answered")
        self.assertEqual(result["sources"][0]["label"], "S1")
        self.assertEqual(result["actions"][0]["type"], "select_ligand")
        self.assertEqual(len(conversations[result["conversation_id"]]), 2)
        self.assertEqual(asyncio.run(source("paper-1"))["label"], "S1")
        classify.assert_called_once()

    @patch("backend.app.search_europe_pmc")
    @patch("backend.app.classify_scope", return_value=False)
    def test_declined_contract_is_consistent_and_skips_retrieval(self, classify, search):
        result = asyncio.run(chat(ChatRequest(question="Who won the cricket match?"), self.request))

        self.assertEqual(result["disposition"], "declined")
        self.assertEqual(result["sources"], [])
        self.assertEqual(result["actions"], [])
        search.assert_not_called()

    def test_unknown_source_keeps_the_existing_not_found_contract(self):
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(source("missing-source"))

        self.assertEqual(raised.exception.status_code, 404)
