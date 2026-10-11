import unittest
from unittest.mock import patch

from backend.rag import (
    CloudflareProvider,
    Evidence,
    build_search_query,
    cited_source_indexes,
    contextual_search_question,
    cosine_similarity,
    resolve_viewer_actions,
    scope_hint,
    strip_model_reasoning,
    validate_viewer_actions,
)


class ScopeTests(unittest.TestCase):
    def test_allows_molecular_questions(self):
        self.assertEqual(scope_hint("How does myoglobin bind oxygen?"), "allow")
        self.assertEqual(scope_hint("Explain CRISPR Cas9 specificity"), "allow")

    def test_rejects_clear_off_topic_questions(self):
        self.assertEqual(scope_hint("Who won the cricket match?"), "reject")
        self.assertEqual(scope_hint("What is the weather forecast?"), "reject")
        self.assertEqual(scope_hint("Write Python code for a protein dashboard"), "reject")

    def test_leaves_unknown_entities_for_model_classification(self):
        self.assertEqual(scope_hint("What does BRCA1 do?"), "classify")


class RetrievalTests(unittest.TestCase):
    def test_search_query_removes_conversational_words(self):
        self.assertEqual(
            build_search_query("How does myoglobin bind and release oxygen in muscle?"),
            "myoglobin AND oxygen AND muscle",
        )

    def test_hidden_reasoning_is_never_exposed(self):
        self.assertEqual(strip_model_reasoning("analysis text</think>\nFinal answer [S1]"), "Final answer [S1]")
        self.assertEqual(strip_model_reasoning("<think>analysis</think>Visible"), "Visible")

    def test_cosine_similarity(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [1, 0]), 1.0)
        self.assertAlmostEqual(cosine_similarity([1, 0], [0, 1]), 0.0)
        self.assertEqual(cosine_similarity([], []), 0.0)

    def test_only_valid_citations_are_returned(self):
        self.assertEqual(cited_source_indexes("One [S2], two [S1], repeat [S2], invalid [S8].", 3), [0, 1])
        self.assertEqual(cited_source_indexes("Combined evidence [S1, S3].", 3), [0, 2])

    def test_public_source_has_label_and_rounded_score(self):
        source = Evidence("id", "Title", "Excerpt", "Author", "Journal", "2024", "https://example.test", score=0.123456)
        self.assertEqual(source.public("S1")["label"], "S1")
        self.assertEqual(source.public("S1")["score"], 0.1235)

    def test_deictic_questions_use_the_attached_structure_for_retrieval(self):
        context = {"title": "Human myoglobin", "description": "oxygen-binding protein", "selection": None, "ligands": []}
        self.assertIn("Human myoglobin", contextual_search_question("How does this bind oxygen?", context))
        self.assertTrue(contextual_search_question("How does this bind oxygen?", context).startswith("Human myoglobin"))
        self.assertEqual(contextual_search_question("How does hemoglobin bind oxygen?", context), "How does hemoglobin bind oxygen?")

    def test_viewer_actions_are_allowlisted_and_bound_to_the_active_object(self):
        context = {
            "object_id": "object-2",
            "chains": ["A"],
            "residues": [{"id": "A:42:GLY", "label": "GLY 42 · chain A"}],
            "ligands": [{"id": "A:501:HEM", "label": "HEM 501 · chain A"}],
        }
        actions = validate_viewer_actions([
            {"type": "select_ligand", "target": "A:501:HEM"},
            {"type": "select_residue", "target": "A:999:ALA"},
            {"type": "script", "target": "alert(1)"},
            {"type": "fit", "target": ""},
        ], context)
        self.assertEqual([action["type"] for action in actions], ["select_ligand", "fit"])
        self.assertTrue(all(action["object_id"] == "object-2" for action in actions))

    def test_explicit_highlight_request_uses_the_validated_current_selection(self):
        context = {
            "object_id": "object-2",
            "chains": ["A"],
            "residues": [{"id": "A:501:HEM", "label": "HEM 501 · chain A"}],
            "ligands": [{"id": "A:501:HEM", "label": "HEM 501 · chain A"}],
            "selection": {"kind": "ligand", "residue_ids": ["A:501:HEM"], "chain": "A"},
        }
        actions = resolve_viewer_actions("Please highlight the selected ligand.", [], context)
        self.assertEqual(actions, [{
            "type": "select_ligand",
            "target": "A:501:HEM",
            "label": "Highlight HEM 501 · chain A",
            "object_id": "object-2",
        }])
        self.assertEqual(resolve_viewer_actions("What does this ligand do?", [], context), [])


class CloudflareProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = CloudflareProvider(
            "account-123",
            "secret-token",
            "@cf/meta/llama-3.1-8b-instruct",
            "@cf/baai/bge-base-en-v1.5",
        )

    def test_health_checks_configuration_without_spending_inference(self):
        self.assertEqual(self.provider.health()["status"], "ready")
        missing = CloudflareProvider("", "", "chat", "embed").health()
        self.assertEqual(missing["status"], "setup_required")
        self.assertEqual(missing["missing_configuration"], ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"])

    @patch("backend.rag._request_json")
    def test_structured_generation_keeps_token_in_authorization_header(self, request_json):
        request_json.return_value = {"success": True, "result": {"response": {"in_scope": True}}}
        schema = {"type": "object", "properties": {"in_scope": {"type": "boolean"}}}

        result = self.provider.generate_json([{"role": "user", "content": "BRCA1"}], schema)

        self.assertEqual(result, {"in_scope": True})
        _, kwargs = request_json.call_args
        self.assertEqual(kwargs["headers"], {"Authorization": "Bearer secret-token"})
        self.assertEqual(kwargs["payload"]["response_format"]["json_schema"], schema)

    @patch("backend.rag._request_json")
    def test_embedding_response_is_unwrapped(self, request_json):
        request_json.return_value = {"success": True, "result": {"data": [[1.0, 0.0], [0.0, 1.0]]}}

        vectors = self.provider.embed(["one", "two"])

        self.assertEqual(vectors, [[1.0, 0.0], [0.0, 1.0]])
        self.assertEqual(request_json.call_args.kwargs["payload"], {"text": ["one", "two"], "pooling": "cls"})


if __name__ == "__main__":
    unittest.main()
