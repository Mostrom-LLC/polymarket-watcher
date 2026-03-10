# Testing Policy

## ⚠️ NO MOCK DATA — TEST LIKE A REAL USER

**All tests must behave like real users with real credentials.**

### Why?

Mock data hides bugs. In this project, mocked Polymarket API responses caused MOS-92 — tests passed but the app couldn't fetch real data because the mock format didn't match the actual API response.

### Core Principle

> If you're testing authentication, Playwright must launch and sign into the app with **real credentials** as if it was a real end user.

This applies to everything: API calls, OAuth flows, database operations, external services.

### Rules

1. **Unit Tests**
   - Test pure logic and transformations only
   - If a function needs external data, it's an integration test

2. **Integration Tests**
   - Must call real external APIs (Polymarket, Gemini, Slack)
   - Must use real credentials (test accounts OK, mocks NOT OK)
   - Must hit real databases (test DB OK, in-memory mocks NOT OK)

3. **E2E / Playwright Tests**
   - Must launch real browser
   - Must sign in with real user credentials
   - Must complete real user flows
   - Must verify real data appears in UI
   - Test accounts are fine, but they must be real accounts

### Test Environment Variables

```bash
# Required for integration/E2E tests
GEMINI_API_KEY=...           # Real Gemini API key
SLACK_BOT_TOKEN=...          # Real Slack bot token  
SLACK_TEST_CHANNEL=...       # Test channel for E2E
REDIS_URL=...                # Real Redis instance

# For Playwright auth tests
TEST_USER_EMAIL=...          # Real test user account
TEST_USER_PASSWORD=...       # Real password
```

### What's Allowed

- ✅ Dedicated test accounts (real accounts, just for testing)
- ✅ Test environments/databases (real infra, isolated data)
- ✅ Test Slack channels (real channel, just for test posts)
- ✅ Rate limit awareness (add delays between API calls)
- ✅ Test fixtures for input data you generate/control

### What's NOT Allowed

- ❌ Mocking HTTP responses from external APIs
- ❌ Mocking SDK clients (Gemini, Slack)
- ❌ Mocking authentication/OAuth flows
- ❌ In-memory databases instead of real ones
- ❌ Snapshot tests of API responses
- ❌ Hardcoded "expected" API response structures
- ❌ `jest.mock()` or `vi.mock()` for external services

### Running Tests

```bash
# Must have real credentials configured
cd application
cp .env.example .env
# Fill in real API keys AND test user credentials

npm test
```

Tests will fail without valid credentials. This is intentional — it proves the test is real.
