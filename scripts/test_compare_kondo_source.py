import unittest
from compare_kondo_source import classify


class ComparisonTests(unittest.TestCase):
    def test_same_result_is_skipped(self):
        self.assertEqual(classify("old", "new", "new"), "already_equal")

    def test_new_kondo_change_is_kept(self):
        self.assertEqual(classify("old", "old", "kondo"), "keep_kondo")

    def test_clean_baseline_is_a_candidate(self):
        self.assertEqual(classify("old", "new", "old"), "candidate_change")

    def test_two_changes_need_merge(self):
        self.assertEqual(classify("old", "gpt", "kondo"), "needs_merge")

    def test_new_file_collision_and_local_deletion_are_not_overwritten(self):
        self.assertEqual(classify(None, "gpt", "kondo"), "needs_merge")
        self.assertEqual(classify("old", "gpt", None), "needs_merge")
        self.assertEqual(classify(None, "gpt", None), "candidate_change")


if __name__ == "__main__":
    unittest.main()
