import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataApiClient } from "./data-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const userAddress = "0x56687bf447db6ffa42ffe2204a05edaa20f55839";
const conditionA = "0xdd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917";
const conditionB = "0xaa22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110918";

describe("DataApiClient", () => {
  let client: DataApiClient;

  beforeEach(() => {
    client = new DataApiClient({ retries: 0, timeout: 5000 });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and parses user activity with market filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          proxyWallet: userAddress,
          timestamp: 1_773_379_200,
          conditionId: conditionA,
          type: "TRADE",
          size: 1200,
          usdcSize: 780,
          transactionHash: "0x1234",
          price: 0.65,
          asset: "token-yes",
          side: "BUY",
          outcomeIndex: 0,
          title: "US x Iran ceasefire by March 31?",
          slug: "us-x-iran-ceasefire-by-march-31",
          icon: "https://example.com/icon.png",
          eventSlug: "us-x-iran-ceasefire-by",
          outcome: "Yes",
        },
      ]),
    });

    const activity = await client.getUserActivity({
      user: userAddress,
      market: [conditionA],
      limit: 50,
      sortDirection: "DESC",
      side: "BUY",
      type: ["TRADE"],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://data-api.polymarket.com/activity?user=${userAddress}&market=${conditionA}&limit=50&type=TRADE&sortDirection=DESC&side=BUY`
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]?.timestamp).toBeInstanceOf(Date);
    expect(activity[0]?.eventSlug).toBe("us-x-iran-ceasefire-by");
    expect(activity[0]?.side).toBe("BUY");
  });

  it("fetches current positions for a user", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          proxyWallet: userAddress,
          asset: "token-yes",
          conditionId: conditionA,
          size: 1250,
          avgPrice: 0.63,
          initialValue: 788,
          currentValue: 912,
          cashPnl: 124,
          percentPnl: 15.74,
          totalBought: 1250,
          realizedPnl: 0,
          percentRealizedPnl: 0,
          curPrice: 0.73,
          redeemable: false,
          mergeable: false,
          title: "US x Iran ceasefire by March 31?",
          slug: "us-x-iran-ceasefire-by-march-31",
          icon: "https://example.com/icon.png",
          eventSlug: "us-x-iran-ceasefire-by",
          outcome: "Yes",
          outcomeIndex: 0,
          oppositeOutcome: "No",
          oppositeAsset: "token-no",
          endDate: "2026-03-31T00:00:00Z",
          negativeRisk: false,
        },
      ]),
    });

    const positions = await client.getUserPositions({
      user: userAddress,
      eventId: [4123],
      sizeThreshold: 100,
      limit: 25,
      sortBy: "CURRENT",
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://data-api.polymarket.com/positions?user=${userAddress}&eventId=4123&sizeThreshold=100&limit=25&sortBy=CURRENT`
    );
    expect(positions[0]?.endDate).toBeInstanceOf(Date);
    expect(positions[0]?.currentValue).toBe(912);
    expect(positions[0]?.outcome).toBe("Yes");
  });

  it("fetches closed positions for repeated-wins enrichment", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          proxyWallet: userAddress,
          asset: "token-yes",
          conditionId: conditionA,
          avgPrice: 0.25,
          totalBought: 1000,
          realizedPnl: 340,
          curPrice: 1,
          timestamp: 1_773_465_600,
          title: "Military action against Iran ends on March 21, 2026?",
          slug: "military-action-against-iran-ends-on-march-21-2026",
          icon: "https://example.com/icon.png",
          eventSlug: "military-action-against-iran-ends-on",
          outcome: "Yes",
          outcomeIndex: 0,
          oppositeOutcome: "No",
          oppositeAsset: "token-no",
          endDate: "2026-03-21T00:00:00Z",
        },
      ]),
    });

    const closedPositions = await client.getClosedPositions({
      user: userAddress,
      market: [conditionA],
      limit: 10,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://data-api.polymarket.com/closed-positions?user=${userAddress}&market=${conditionA}&limit=10`
    );
    expect(closedPositions[0]?.timestamp).toBeInstanceOf(Date);
    expect(closedPositions[0]?.realizedPnl).toBe(340);
  });

  it("fetches top holders for one or more markets", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        {
          token: "token-yes",
          holders: [
            {
              proxyWallet: userAddress,
              bio: "macro trader",
              asset: "token-yes",
              pseudonym: "alpha-wallet",
              amount: 5000,
              displayUsernamePublic: true,
              outcomeIndex: 0,
              name: "Alpha Wallet",
              profileImage: "https://example.com/profile.png",
              profileImageOptimized: "https://example.com/profile-small.png",
            },
          ],
        },
      ]),
    });

    const holders = await client.getMarketHolders({
      market: [conditionA, conditionB],
      limit: 20,
      minBalance: 10,
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://data-api.polymarket.com/holders?market=${conditionA}%2C${conditionB}&limit=20&minBalance=10`
    );
    expect(holders[0]?.token).toBe("token-yes");
    expect(holders[0]?.holders[0]?.amount).toBe(5000);
  });
});
