import unittest

from backend.rag import Evidence, build_search_query, cited_source_indexes, cosine_similarity, scope_hint, strip_model_reasoning


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

    def test_public_source_has_label_and_rounded_score(self):
        source = Evidence("id", "Title", "Excerpt", "Author", "Journal", "2024", "https://example.test", score=0.123456)
        self.assertEqual(source.public("S1")["label"], "S1")
        self.assertEqual(source.public("S1")["score"], 0.1235)


if __name__ == "__main__":
    unittest.main()
