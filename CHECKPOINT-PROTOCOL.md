# CHECKPOINT PROTOCOL
### Anti-Hallucination & Verification Standards for umayal-study-coach
_Effective: 2026-06-22. Applies to: Itachi (AI assistant) and any developer on this project._

---

## Why This File Exists

The AI assistant working on this project has fabricated chapter names, reported features
as working without testing them, and delivered AI-formatted content without verifying it
matched the source material — all with complete confidence.

This document is the process that prevents that. It is not optional.

---

## Protocol 1: Before Writing Any Code

Before touching a file, state:

```
BEFORE-CODE DECLARATION
- What I am about to change: [specific file(s) and function(s)]
- Why this change is needed: [the actual problem being solved]
- What I expect the result to be: [specific, testable outcome]
- How I will verify it worked: [exact verification step]
```

If you cannot fill out all four fields, you don't understand the task well enough to code it.

---

## Protocol 2: After Each File Change

After modifying any file, before moving to the next:

1. **Show the actual diff or specific lines changed** — not a description, the actual code
2. **State what the change does** in one sentence, grounded in code
3. **Note any side effects**

```
CHANGE CHECKPOINT — [filename]
Lines changed: [e.g., 47–52, 103]
What changed: [paste actual diff or excerpt]
What this does: [one concrete sentence]
Side effects: [or "none identified"]
```

---

## Protocol 3: Before Pushing / Deploying

Run the app locally and paste actual output for each:

- [ ] App starts without errors: paste startup log (last 20 lines)
- [ ] Hit the changed endpoint: paste actual HTTP response
- [ ] Hit `/api/verify/chapter/{subject}/{chapter_num}` for at least one chapter: paste full JSON
- [ ] Check `ai_calls.log` for any VALIDATION FAIL warnings

Do not declare ready until all boxes are checked with real output.

---

## Protocol 4: Before Saying "It's Done"

"It's done" requires evidence — one or more of:

- A pasted HTTP response from actually calling the endpoint
- A pasted terminal output from running the function
- A screenshot showing the UI in the claimed state
- A pasted log excerpt from `ai_calls.log`

If you cannot provide evidence:
"I have written the code. I have not yet verified it runs correctly. Here is how to verify: [specific command or URL]."

**"It should work" without evidence is not acceptable on this project.**

---

## Protocol 5: When Mapping Data

When building any mapping (chapter numbers → names, files → subjects, etc.):

1. **Read the source.** Don't infer from variable names or file names. Open the file. Read actual values.
2. **Show the full mapping table:**

```
DATA MAPPING — VERIFY BEFORE PROCEEDING
Source: [file actually read]

| Input Key | Mapped Value (from source) | Notes |
|-----------|---------------------------|-------|
| [value]   | [verbatim from source]    |       |

@Aarthi: Confirm this mapping before I proceed.
```

3. **Wait for explicit confirmation.**
4. **Reference the confirmed mapping** as a named constant, not hardcoded strings.

---

## Protocol 6: When AI Processes Content

When AI formats, rewrites, or transforms content:

1. **Show input sample** (first 300+ chars of source)
2. **Show output sample** (first 300+ chars of result)
3. **Run `validate_formatted_content()`** and show result
4. **If validation fails:** return raw text with warning. Do not deliver potentially wrong content.

```
AI PROCESSING CHECKPOINT
Input sample:  "[first 300 chars]"
Output sample: "[first 300 chars]"
Validation:    matched=[...] | missing=[...] | valid=True/False
Decision:      [deliver formatted / fall back to raw + warning]
```

---

## Quick Reference

| Action | Required Checkpoint |
|--------|-------------------|
| Stating a chapter name | Read from JSON first, quote verbatim |
| Claiming an endpoint works | Paste the actual HTTP response |
| AI formatting a chapter | Run validation, show before/after |
| Mapping files to content | Show mapping table, get confirmation |
| Changing any file | Show actual diff |
| Saying "it's done" | Provide evidence (response/log/screenshot) |
| Deploying or pushing | Complete Protocol 3 checklist |

---

## When In Doubt

Read the file. Run the code. Show the output. Ask before assuming.

A 30-second verification checkpoint saves hours of rework.
