---
"@executor-js/fumadb": minor
---

Add guarded bulk replacement to the database adapters. Callers can replace rows only while they still own a rebuild claim, and inserts respect driver parameter limits.
