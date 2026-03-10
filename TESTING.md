# Testing Policy

## ⚠️ NO MOCK DATA

**All tests must use real API calls. Do not mock external API responses.**

### Why?

Mock data hides bugs. In this project, mocked Polymarket API responses caused MOS-92 — tests passed but the app couldn't fetch real data because the mock format didn't match the actual API response.

### Rules

1. **Unit Tests**
   - Test pure logic and transformations only
   - If a function needs external data, it's an integration test

2. **Integration Tests**
   - Must call real external APIs (Polymarket, Gemini, Slack)
   - Use test/sandbox credentials where available
   - Acceptable to use a test Slack channel

3. **E2E Tests**
   - Must verify complete data flow with real services
   - Must post to real Slack channel (test channel OK)
   - Must fetch real market data

### Test Environment Variables

```bash
# Required for integration/E2E tests
GEMINI_API_KEY=...           # Real Gemini API key
SLACK_BOT_TOKEN=...          # Real Slack bot token  
SLACK_TEST_CHANNEL=...       # Test channel for E2E
REDIS_URL=...                # Real Redis instance
```

### What's Allowed

- ✅ Test fixtures for input data you control
- ✅ Stub internal functions for isolation
- ✅ Use test Slack channels instead of production
- ✅ Rate limit awareness (add delays between API calls)

### What's NOT Allowed

- ❌ Mocking HTTP responses from external APIs
- ❌ Mocking SDK clients (Anthropic, Gemini, Slack)
- ❌ Snapshot tests of API responses
- ❌ Hardcoded "expected" API response structures

### Running Tests

```bash
# Must have real credentials configured
cp .env.example .env
# Fill in real API keys

npm test
```

Tests will fail without valid credentials. This is intentional.
