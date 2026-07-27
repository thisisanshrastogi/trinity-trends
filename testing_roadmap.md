# Trinity Trends Unit Testing Roadmap

Welcome to the Trinity Trends testing roadmap! Writing unit tests is one of the best ways to deeply understand a codebase because it forces you to think about how each module behaves in isolation. 

This roadmap is divided into progressive phases. We will start with the easiest, most self-contained modules and work our way up to the complex integrations and UI components. 

For each module, check the box once you've completed it. When you are ready to start a section, just copy the **"AI Prompt"** block and paste it in a new or existing chat with me.

---w

## 🛠️ Tools We Will Learn
- **Vitest / Jest**: The main testing framework for running tests and making assertions (e.g., `expect(a).toBe(b)`).
- **Mocking**: Overriding external dependencies (like databases, APIs, or subprocesses) so we can test our code in isolation.
- **ink-testing-library**: A specialized tool to test terminal UI (React) components.

---

## Phase 1: The Foundation (Storage Layer)
*The storage layer is the perfect place to start. It doesn't rely on external APIs or the internet. We will learn how to use an in-memory SQLite database to test database queries safely.*

- [ ] **1.1 SQLite Client (`src/storage/sqlite/sqlite.client.ts`)**
  - **What we'll learn:** Testing class instantiation, ensuring database migrations run correctly, and verifying that WAL/Foreign Keys are enabled.
  - **AI Prompt to start:**
    > "I want to start Phase 1.1 of my testing roadmap: Testing `SqliteClient`. Please explain how we can use an in-memory SQLite database for testing, what tools we need (Vitest, etc.), and guide me step-by-step to write the first test for database initialization and migrations."

- [ ] **1.2 SQLite Repository (`src/storage/sqlite/sqlite.repository.ts`)**
  - **What we'll learn:** Testing CRUD (Create, Read, Update, Delete) operations. We will write tests to ensure Users, Sessions, and Topics are saved and retrieved correctly.
  - **AI Prompt to start:**
    > "I'm ready for Phase 1.2: Testing `SqliteRepository`. Let's write unit tests for the user and session creation methods. Please show me how to mock the `SqliteClient` or use an in-memory DB to test the repository layer without touching the real disk."

---

## Phase 2: External Interactions (Collectors)
*Collectors reach out to the real world (APIs and Subprocesses). Here we learn how to "mock" (fake) the outside world so our tests run fast and don't get banned for API rate limits.*

- [ ] **2.1 HTTP Collectors (`src/collectors/youtube/` or `reddit/`)**
  - **What we'll learn:** How to intercept and fake HTTP network requests using mocking libraries. We'll test how the collector handles successful responses and network errors.
  - **AI Prompt to start:**
    > "I'm ready for Phase 2.1: Testing HTTP Collectors (let's pick YouTube or Reddit). Please explain how we can mock `fetch` or Axios requests in Vitest. Help me write a test that verifies the collector parses a successful JSON response and another test that handles an API error gracefully."

- [ ] **2.2 Subprocess Collectors (`src/collectors/instagram/`)**
  - **What we'll learn:** The Instagram scraper uses Python subprocesses. We will learn how to mock Node's `child_process.exec` or `spawn` to simulate the Python script succeeding or crashing.
  - **AI Prompt to start:**
    > "I'm ready for Phase 2.2: Testing the Instagram Collector. Since it relies on a Python subprocess, please teach me how to mock Node's `child_process` in Vitest. We need to write a test simulating a successful Python JSON output, and one simulating a missing dependencies error."

---

## Phase 3: AI Orchestration (Intent & Expansion)
*This is the brain of Trinity Trends. We need to test if we are sending the right prompts to the LLM and if we can correctly parse the LLM's JSON response.*

- [ ] **3.1 Intent Parser (`src/intent/`)**
  - **What we'll learn:** Mocking the Gemini/Groq SDK. We'll test the regex/JSON extraction logic to ensure our code doesn't crash if the LLM returns slightly malformed JSON.
  - **AI Prompt to start:**
    > "I'm ready for Phase 3.1: Testing the Intent Parser. Please show me how to mock the Gemini/Groq API SDK. Let's write a test that verifies the parser correctly extracts a domain intent, and another test to see how it handles a hallucinated/invalid JSON response from the LLM."

- [ ] **3.2 Topic Expander (`src/expansion/`)**
  - **What we'll learn:** Similar to Intent parsing, but focusing on handling large arrays of data and deduplication logic before saving to the database.
  - **AI Prompt to start:**
    > "I'm ready for Phase 3.2: Testing the Topic Expander. Let's write tests to mock the LLM response and ensure that the expander correctly deduplicates topics and generates the right data structures."

---

## Phase 4: Terminal User Interface (Ink)
*Testing UI is very different from testing backend logic. We will use a testing library designed specifically for React Ink to simulate user keypresses.*

- [ ] **4.1 UI Components (`src/app/ui/views/`)**
  - **What we'll learn:** Using `ink-testing-library`. We will mount components like `PreflightCheck` or `MainMenu` in a virtual terminal, simulate keyboard inputs (like pressing Arrow Down or Enter), and verify the screen text updates correctly.
  - **AI Prompt to start:**
    > "I'm ready for Phase 4: Testing the Ink TUI components. Let's start with `MainMenu` or `PreflightCheck`. Please explain how `ink-testing-library` works, how to simulate user keypresses, and guide me in writing a test to verify a view transitions correctly on an Enter keypress."

---

## 🏆 Final Boss: Integration Tests
*Integration tests ensure all the LEGO blocks fit together. Instead of testing one file in isolation, we test the entire pipeline (from Intent -> Expansion -> Collection -> Database) with mocked network calls.*

- [ ] **5.1 Pipeline Orchestrator (`src/pipeline/` or equivalent)**
  - **What we'll learn:** Writing a massive end-to-end test (without touching the real internet or disk) to prove the whole application works as a cohesive unit.
  - **AI Prompt to start:**
    > "I've completed all unit test phases! I'm ready for the Final Boss: Integration Testing the whole pipeline. Let's write a test that walks through an entire session lifecycle, using our in-memory SQLite and mocked APIs. Guide me on how to set up this complex test."
